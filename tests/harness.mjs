import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendCode = fs.readFileSync(path.join(root, 'dist', 'backend.js'), 'utf8')

const macroHandlers = new Map()
const frontendMessages = []
const chatVars = new Map()
const localVars = new Map()
const globalVarsByUser = new Map([['user-1', new Map()], ['user-2', new Map()]])
const globalVars = globalVarsByUser.get('user-1')
const storageFiles = new Map()
const userStorageFiles = new Map()
let frontendHandler = null
let rng = 0
const randomValues = [0.02, 0.66, 0.31, 0.92, 0.47, 0.78, 0.15, 0.58]
const deterministicRandom = () => randomValues[(rng++) % randomValues.length]

const activeChat = {
  id: 'chat-1',
  name: 'Harness Chat',
  character_id: 'char-1',
}

function storeFor(scope) {
  if (scope === 'chat') return chatVars
  if (scope === 'local') return localVars
  return globalVars
}

function variableApi(scope) {
  const store = storeFor(scope)
  return {
    async list(..._args) { return Object.fromEntries(store) },
    async get(...args) { return store.get(String(args.at(-1))) },
    async set(...args) {
      const key = String(args.at(-2))
      const value = String(args.at(-1) ?? '')
      store.set(key, value)
    },
    async delete(...args) { store.delete(String(args.at(-1))) },
  }
}

function requireOperatorUserId(userId) {
  if (!userId) throw new Error('userId is required for operator-scoped extensions')
  return String(userId)
}

function globalsFor(userId) {
  const id = requireOperatorUserId(userId)
  let store = globalVarsByUser.get(id)
  if (!store) {
    store = new Map()
    globalVarsByUser.set(id, store)
  }
  return store
}

const globalVariableApi = {
  async list(userId) { return Object.fromEntries(globalsFor(userId)) },
  async get(key, userId) { return String(globalsFor(userId).get(String(key)) ?? '') },
  async set(key, value, userId) { globalsFor(userId).set(String(key), String(value ?? '')) },
  async delete(key, userId) { globalsFor(userId).delete(String(key)) },
  async has(key, userId) { return globalsFor(userId).has(String(key)) },
}

function splitArgs(source) {
  return source.split('::')
}

async function resolveTemplate(template, options = {}) {
  const commit = options.commit !== false
  const envChat = new Map(chatVars)
  const env = {
    chat: options.chatId ? { id: options.chatId } : null,
    character: options.characterId ? { id: options.characterId } : null,
    extra: { chatId: options.chatId ?? '', characterId: options.characterId ?? '', userId: options.userId ?? '' },
    variables: {
      chat: envChat,
      local: new Map(localVars),
      global: new Map(globalsFor(options.userId)),
    },
  }

  async function evaluateMacro(inner) {
    const parts = splitArgs(inner)
    const name = parts.shift().trim()
    const args = parts

    if (name === 'setchatvar') {
      const key = String(args[0] ?? '')
      const value = String(args.slice(1).join('::') ?? '')
      envChat.set(key, value)
      if (commit && options.chatId) chatVars.set(key, value)
      return ''
    }

    if (name === 'getchatvar') return String(envChat.get(String(args[0] ?? '')) ?? '')

    if (name === 'random') {
      if (args.length >= 2) {
        const low = Number(args[0])
        const high = Number(args[1])
        if (Number.isFinite(low) && Number.isFinite(high)) {
          const min = Math.min(low, high)
          const max = Math.max(low, high)
          if (Number.isInteger(min) && Number.isInteger(max)) {
            return String(min + Math.floor(deterministicRandom() * (max - min + 1)))
          }
          return String(min + deterministicRandom() * (max - min))
        }
      }
      return String(deterministicRandom())
    }

    if (name === 'pick') {
      if (!args.length) return ''
      return String(args[Math.floor(deterministicRandom() * args.length)] ?? '')
    }

    if (name === 'char') return 'Elara'

    const definition = macroHandlers.get(name)
    if (!definition) return `{{${inner}}}`
    return String(await definition.handler({ args, env, commit, userId: options.userId ?? '' }) ?? '')
  }

  let text = String(template)
  for (let pass = 0; pass < 128; pass += 1) {
    const start = text.lastIndexOf('{{')
    if (start < 0) break
    const end = text.indexOf('}}', start + 2)
    if (end < 0) break
    const inner = text.slice(start + 2, end)
    const replacement = await evaluateMacro(inner)
    text = text.slice(0, start) + replacement + text.slice(end + 2)
  }
  return { text, diagnostics: [] }
}

const spindle = {
  registerMacro(definition) {
    if (macroHandlers.has(definition.name)) throw new Error(`Macro already registered: ${definition.name}`)
    macroHandlers.set(definition.name, definition)
  },
  unregisterMacro(name) { macroHandlers.delete(name) },
  storage: {
    async setJson(key, value) { storageFiles.set(key, structuredClone(value)) },
    async getJson(key, options = {}) { return structuredClone(storageFiles.get(key) ?? options.fallback) },
  },
  userStorage: {
    async setJson(key, value, options = {}) {
      const userId = requireOperatorUserId(options.userId)
      userStorageFiles.set(`${userId}:${key}`, structuredClone(value))
    },
    async getJson(key, options = {}) {
      const userId = requireOperatorUserId(options.userId)
      return structuredClone(userStorageFiles.get(`${userId}:${key}`) ?? options.fallback)
    },
  },
  variables: {
    chat: variableApi('chat'),
    local: variableApi('local'),
    global: globalVariableApi,
  },
  chats: {
    async getActive(_userId) { return activeChat },
  },
  macros: {
    resolve: resolveTemplate,
  },
  onFrontendMessage(handler) { frontendHandler = handler },
  sendToFrontend(payload, userId) { frontendMessages.push({ payload, userId }) },
  log: {
    info() {},
    warn(...args) { console.warn('[harness warn]', ...args) },
    error(...args) { console.error('[harness error]', ...args) },
  },
}

const sandboxMath = Object.create(Math)
sandboxMath.random = deterministicRandom
vm.runInNewContext(backendCode, {
  spindle,
  console,
  Math: sandboxMath,
  Date,
  Map,
  Set,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Promise,
  encodeURIComponent,
  decodeURIComponent,
  structuredClone,
  setTimeout,
  clearTimeout,
}, { filename: 'dist/backend.js' })

await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(typeof frontendHandler, 'function', 'backend should register a frontend message handler')
assert(macroHandlers.has('lmlDecisionPick'), 'internal sticky pick macro should register')
assert(macroHandlers.has('lmlDecisionRandom'), 'internal sticky random macro should register')

async function requestAs(userId, payload) {
  frontendMessages.length = 0
  await frontendHandler({ ...payload, requestId: payload.requestId ?? `req-${Date.now()}-${rng}` }, userId)
  assert(frontendMessages.length > 0, `request ${payload.type} should answer`)
  assert.equal(frontendMessages.at(-1).userId, userId, 'operator responses must target the originating user')
  return frontendMessages.at(-1).payload
}

const request = (payload) => requestAs('user-1', payload)

function decisionVars() {
  return [...chatVars.entries()].filter(([key]) => key.startsWith('__lml_state__'))
}

function parseDecision(raw) {
  return JSON.parse(decodeURIComponent(raw))
}

// Register a macro with nested stochastic nodes.
let response = await request({
  type: 'lumi_macro_lab:save_macro',
  definition: {
    name: 'backstory',
    description: 'Harness backstory',
    body: 'Born in {{pick::the coast::the capital}}; raised by {{pick::scholars::smugglers}}; age {{random::12::19}}.',
  },
})
assert.equal(response.type, 'lumi_macro_lab:state')
assert(macroHandlers.has('backstory'))

// First committed resolve creates three decision variables and strips internal setchatvar output.
const first = await resolveTemplate('{{backstory::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: true })
assert(!first.text.includes('{{'), 'resolved output should contain no unresolved macros')
assert.equal(decisionVars().length, 3, 'first committed resolve should persist all stochastic decisions')

// Re-resolving the same instance is sticky.
const second = await resolveTemplate('{{backstory::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: true })
assert.equal(second.text, first.text, 'same instance should reuse sticky choices')
assert.equal(decisionVars().length, 3)

// A dry run of a fresh instance samples but must not persist new decision state.
const beforeDry = decisionVars().length
const dry = await resolveTemplate('{{backstory::bob}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: false })
assert(!dry.text.includes('{{'))
assert.equal(decisionVars().length, beforeDry, 'commit:false must not persist newly sampled state')

// State inspector must surface the three alice decisions.
response = await request({ type: 'lumi_macro_lab:get_state' })
assert.equal(response.type, 'lumi_macro_lab:state')
const aliceDecisions = response.decisions.filter(({ state }) => state.macroName === 'backstory' && state.instance === 'alice')
assert.equal(aliceDecisions.length, 3)

// Reroll a pick and confirm both persisted state and rendered output change.
const pickDecision = aliceDecisions.find(({ state }) => state.kind === 'pick')
assert(pickDecision)
const beforePick = pickDecision.state.value
response = await request({ type: 'lumi_macro_lab:decision_action', key: pickDecision.key, action: 'reroll' })
assert.equal(response.type, 'lumi_macro_lab:state')
const rerolled = response.decisions.find(({ key }) => key === pickDecision.key)
assert(rerolled)
assert.notEqual(rerolled.state.value, beforePick, 'pick reroll should select a different saved option when possible')
const afterReroll = await resolveTemplate('{{backstory::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: true })
assert.notEqual(afterReroll.text, first.text, 'rerolled decision should affect later render')

// Lock protects the decision from direct reroll.
response = await request({ type: 'lumi_macro_lab:decision_action', key: pickDecision.key, action: 'toggle_lock' })
assert.equal(response.type, 'lumi_macro_lab:state')
assert.equal(response.decisions.find(({ key }) => key === pickDecision.key).state.locked, true)
response = await request({ type: 'lumi_macro_lab:decision_action', key: pickDecision.key, action: 'reroll' })
assert.equal(response.type, 'lumi_macro_lab:error')
assert.match(response.error, /locked/i)

// Bulk reset leaves locked decisions alone and clears the rest.
response = await request({ type: 'lumi_macro_lab:instance_action', macroName: 'backstory', instance: 'alice', action: 'reset' })
assert.equal(response.type, 'lumi_macro_lab:state')
const afterReset = response.decisions.filter(({ state }) => state.macroName === 'backstory' && state.instance === 'alice')
assert.equal(afterReset.length, 1, 'bulk reset should leave only the locked decision')
assert.equal(afterReset[0].state.locked, true)

// Native variable inspector writes through the Spindle variable API.
response = await request({ type: 'lumi_macro_lab:variable_action', scope: 'chat', action: 'set', key: 'weather', value: 'rain' })
assert.equal(response.type, 'lumi_macro_lab:state')
assert.equal(chatVars.get('weather'), 'rain')
assert.equal(response.variables.chat.weather, 'rain')

// Registered macros can nest; the nested macro gets its own state namespace.
await request({
  type: 'lumi_macro_lab:save_macro',
  definition: { name: 'secret', description: '', body: '{{pick::a debt::a prophecy}}' },
})
await request({
  type: 'lumi_macro_lab:save_macro',
  definition: { name: 'profile', description: '', body: 'Secret: {{secret::alice}} / Mood: {{pick::calm::restless}}' },
})
const nested = await resolveTemplate('{{profile::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: true })
assert(!nested.text.includes('{{'))
response = await request({ type: 'lumi_macro_lab:get_state' })
assert(response.decisions.some(({ state }) => state.macroName === 'profile' && state.instance === 'alice'))
assert(response.decisions.some(({ state }) => state.macroName === 'secret' && state.instance === 'alice'))

// Rename swaps registration cleanly and persists the registry.
response = await request({
  type: 'lumi_macro_lab:save_macro',
  originalName: 'profile',
  definition: { name: 'persona', description: '', body: 'Secret: {{secret::alice}} / Mood: {{pick::calm::restless}}' },
})
assert.equal(response.type, 'lumi_macro_lab:state')
assert(macroHandlers.has('profile'), 'host registration stays alive because another operator user may own the old name')
assert(macroHandlers.has('persona'))
assert(userStorageFiles.get('user-1:macro-registry.json').macros.some((macro) => macro.name === 'persona'))
assert(storageFiles.get('macro-name-index.json').names.includes('persona'))

// Operator-scoped installs isolate definitions and global vars per user while sharing host macro names.
response = await requestAs('user-2', { type: 'lumi_macro_lab:get_state' })
assert.equal(response.type, 'lumi_macro_lab:state')
assert.equal(response.macros.length, 0, 'a second operator user must not see user-1 macro bodies')

response = await requestAs('user-2', {
  type: 'lumi_macro_lab:save_macro',
  definition: { name: 'backstory', description: 'User two version', body: 'USER_TWO {{pick::orchard::desert}}' },
})
assert.equal(response.type, 'lumi_macro_lab:state')
assert.equal(response.macros.length, 1)
const userTwoBackstory = await resolveTemplate('{{backstory::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-2', commit: false })
assert.match(userTwoBackstory.text, /^USER_TWO /)
const userOneBackstory = await resolveTemplate('{{backstory::alice}}', { chatId: activeChat.id, characterId: activeChat.character_id, userId: 'user-1', commit: false })
assert(!userOneBackstory.text.startsWith('USER_TWO '), 'same registered name should dispatch to the invoking user registry')

response = await request({ type: 'lumi_macro_lab:variable_action', scope: 'global', action: 'set', key: 'accent', value: 'pink' })
assert.equal(response.type, 'lumi_macro_lab:state')
response = await requestAs('user-2', { type: 'lumi_macro_lab:variable_action', scope: 'global', action: 'set', key: 'accent', value: 'green' })
assert.equal(response.type, 'lumi_macro_lab:state')
assert.equal(globalsFor('user-1').get('accent'), 'pink')
assert.equal(globalsFor('user-2').get('accent'), 'green')
response = await request({ type: 'lumi_macro_lab:get_state' })
assert.equal(response.variables.global.accent, 'pink')
response = await requestAs('user-2', { type: 'lumi_macro_lab:get_state' })
assert.equal(response.variables.global.accent, 'green')

// Directly verify that persisted decision state is URI-safe JSON and includes recipe metadata.
for (const [, raw] of decisionVars()) {
  const state = parseDecision(raw)
  assert.equal(state.version, 1)
  assert.equal(typeof state.value, 'string')
  assert.equal(typeof state.locked, 'boolean')
}

console.log(`✓ Lumi Macro Lab harness passed (${macroHandlers.size} registered handlers, ${decisionVars().length} persisted decision vars)`)
