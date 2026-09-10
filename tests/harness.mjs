import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const macroHandlers = new Map()
const frontendMessages = []
const chatStores = new Map()
const localStores = new Map()
const globalStores = new Map()
const storageFiles = new Map()
const userStorageFiles = new Map()
const invocationStack = []
let frontendHandler = null
let rng = 0
const randomValues = [0.02, 0.66, 0.31, 0.92, 0.47, 0.78, 0.15, 0.58, 0.84, 0.23]
const originalRandom = Math.random
Math.random = () => randomValues[(rng++) % randomValues.length]

const activeChats = new Map([
  ['user-1', { id: 'chat-1', name: 'Harness Chat One', character_id: 'char-1' }],
  ['user-2', { id: 'chat-2', name: 'Harness Chat Two', character_id: 'char-2' }],
])

function mapFor(pool, id) {
  let store = pool.get(id)
  if (!store) {
    store = new Map()
    pool.set(id, store)
  }
  return store
}

function chatStore(chatId) { return mapFor(chatStores, String(chatId)) }
function localStore(chatId) { return mapFor(localStores, String(chatId)) }
function globalStore(userId) { return mapFor(globalStores, String(userId)) }

function assertMutationAllowed() {
  const frame = invocationStack.at(-1)
  if (frame && frame.commit === false) throw new Error('Harness: mutating variable API rejected inside commit:false macro invocation')
}

const chatVariableApi = {
  async list(chatId) { return Object.fromEntries(chatStore(chatId)) },
  async get(chatId, key) { return chatStore(chatId).get(String(key)) },
  async set(chatId, key, value) {
    assertMutationAllowed()
    chatStore(chatId).set(String(key), String(value ?? ''))
  },
  async delete(chatId, key) {
    assertMutationAllowed()
    chatStore(chatId).delete(String(key))
  },
}

const localVariableApi = {
  async list(chatId) { return Object.fromEntries(localStore(chatId)) },
  async get(chatId, key) { return localStore(chatId).get(String(key)) },
  async set(chatId, key, value) { assertMutationAllowed(); localStore(chatId).set(String(key), String(value ?? '')) },
  async delete(chatId, key) { assertMutationAllowed(); localStore(chatId).delete(String(key)) },
}

const globalVariableApi = {
  async list(userId) { return Object.fromEntries(globalStore(userId)) },
  async get(key, userId) { return globalStore(userId).get(String(key)) },
  async set(key, value, userId) { assertMutationAllowed(); globalStore(userId).set(String(key), String(value ?? '')) },
  async delete(key, userId) { assertMutationAllowed(); globalStore(userId).delete(String(key)) },
}

function requireUserId(userId) {
  if (!userId) throw new Error('userId is required for operator-scoped extensions')
  return String(userId)
}

function splitArgs(source) {
  return source.split('::')
}

async function resolveTemplate(template, options = {}) {
  const commit = options.commit !== false
  const chatId = String(options.chatId ?? '')
  const userId = String(options.userId ?? '')
  const characterId = String(options.characterId ?? '')
  const envChatId = options.envChatId === undefined ? chatId : String(options.envChatId)
  const envSnapshot = Object.freeze({
    chat: envChatId ? Object.freeze({ id: envChatId }) : null,
    character: characterId ? Object.freeze({ id: characterId }) : null,
    extra: Object.freeze({ chatId: envChatId, characterId, userId }),
    variables: Object.freeze({
      chat: Object.freeze(Object.fromEntries(chatStore(chatId))),
      local: Object.freeze(Object.fromEntries(localStore(chatId))),
      global: Object.freeze(Object.fromEntries(globalStore(userId))),
    }),
  })

  async function evaluateMacro(inner) {
    const parts = splitArgs(inner)
    const name = String(parts.shift() ?? '').trim()
    const args = parts

    if (name === 'setchatvar') {
      if (!commit) return ''
      chatStore(chatId).set(String(args[0] ?? ''), String(args.slice(1).join('::') ?? ''))
      return ''
    }
    if (name === 'getchatvar') return String(chatStore(chatId).get(String(args[0] ?? '')) ?? '')
    if (name === 'char') return 'Elara'
    if (name === 'user') return 'Mica'
    if (name === 'pick') {
      if (!args.length) return ''
      return String(args[Math.floor(Math.random() * args.length)] ?? '')
    }
    if (name === 'random') {
      if (args.length >= 2) {
        const low = Number(args[0])
        const high = Number(args[1])
        if (Number.isFinite(low) && Number.isFinite(high)) {
          const min = Math.min(low, high)
          const max = Math.max(low, high)
          if (Number.isInteger(min) && Number.isInteger(max)) return String(min + Math.floor(Math.random() * (max - min + 1)))
          return String(min + Math.random() * (max - min))
        }
      }
      return String(Math.random())
    }

    const definition = macroHandlers.get(name)
    if (!definition) return `{{${inner}}}`
    invocationStack.push({ name, commit })
    try {
      return String(await definition.handler({
        name,
        args,
        commit,
        chatId,
        userId,
        env: envSnapshot,
      }) ?? '')
    } finally {
      invocationStack.pop()
    }
  }

  let text = String(template)
  for (let pass = 0; pass < 256; pass += 1) {
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
      const userId = requireUserId(options.userId)
      userStorageFiles.set(`${userId}:${key}`, structuredClone(value))
    },
    async getJson(key, options = {}) {
      const userId = requireUserId(options.userId)
      return structuredClone(userStorageFiles.get(`${userId}:${key}`) ?? options.fallback)
    },
  },
  variables: { chat: chatVariableApi, local: localVariableApi, global: globalVariableApi },
  chats: { async getActive(userId) { return activeChats.get(String(userId)) ?? null } },
  macros: { resolve: resolveTemplate },
  onFrontendMessage(handler) { frontendHandler = handler },
  sendToFrontend(payload, userId) { frontendMessages.push({ payload, userId }) },
  log: {
    info() {},
    warn(...args) { console.warn('[harness warn]', ...args) },
    error(...args) { console.error('[harness error]', ...args) },
  },
}

globalThis.spindle = spindle
await import(`${pathToFileURL(path.join(root, 'dist', 'backend.js')).href}?forge=${Date.now()}`)
await new Promise((resolve) => setTimeout(resolve, 0))

assert.equal(typeof frontendHandler, 'function', 'backend should register a frontend handler')
assert(macroHandlers.has('mlDecisionPickV2'), 'v2 internal pick macro should register')
assert(macroHandlers.has('mlDecisionRandomV2'), 'v2 internal random macro should register')
assert.equal(macroHandlers.get('mlDecisionPickV2').volatile, true, 'internal pick must be volatile')
assert.equal(macroHandlers.get('mlDecisionRandomV2').volatile, true, 'internal random must be volatile')

async function requestAs(userId, payload) {
  frontendMessages.length = 0
  const req = { ...payload, requestId: payload.requestId ?? `req-${Date.now()}-${rng}` }
  await frontendHandler(req, userId)
  assert(frontendMessages.length, `${payload.type} should answer`)
  const response = frontendMessages.at(-1)
  assert.equal(response.userId, userId, 'operator response must target originating user')
  return response.payload
}

const request = (payload) => requestAs('user-1', payload)

function decisionVars(chatId = 'chat-1') {
  return [...chatStore(chatId).entries()].filter(([key]) => key.startsWith('__macrolab_v2__'))
}

function parseDecision(raw) {
  return JSON.parse(decodeURIComponent(raw))
}

// Definition authoring + human descriptors.
let response = await request({
  type: 'macrolab:save_macro',
  definition: {
    name: 'backstory',
    description: 'Harness backstory',
    body: 'Born in {{pick::the coast::the capital}}. Elara was raised by {{pick::scholars::smugglers}}. At age {{random::12::19}}, everything changed.',
  },
})
assert.equal(response.type, 'macrolab:state')
assert(macroHandlers.has('backstory'))
assert.equal(macroHandlers.get('backstory').volatile, true, 'registered stateful macros must be volatile')
const backstoryView = response.macros.find((macro) => macro.name === 'backstory')
assert(backstoryView)
assert.equal(backstoryView.decisions.length, 3)
assert.match(backstoryView.decisions[0].label, /Born in/i)
assert.match(backstoryView.decisions[1].label, /raised by/i)
assert.match(backstoryView.decisions[2].label, /At age/i)

// Real commit writes directly through chat variables even though env is a frozen structured clone.
const first = await resolveTemplate('{{backstory::alice}}', {
  chatId: 'chat-1',
  envChatId: 'stale-env-chat', // host-trusted ctx.chatId must win over the clone.
  characterId: 'char-1',
  userId: 'user-1',
  commit: true,
})
assert(!first.text.includes('{{'), 'committed resolve should fully resolve')
assert.equal(decisionVars('chat-1').length, 3, 'first committed resolve should persist three v2 decisions')
assert.equal(decisionVars('stale-env-chat').length, 0, 'state must use ctx.chatId, not stale cloned env chat id')
assert.equal([...chatStore('chat-1').keys()].some((key) => key.startsWith('__lml_state__')), false, 'v1 state namespace must not be reused')

// Sticky same-instance behavior.
const second = await resolveTemplate('{{backstory::alice}}', { chatId: 'chat-1', characterId: 'char-1', userId: 'user-1', commit: true })
assert.equal(second.text, first.text, 'same instance should reuse persisted values')

// Dry-run fresh instance: samples but direct variable mutation is never attempted.
const beforeDry = decisionVars().length
const dry = await resolveTemplate('{{backstory::bob}}', { chatId: 'chat-1', characterId: 'char-1', userId: 'user-1', commit: false })
assert(!dry.text.includes('{{'))
assert.equal(decisionVars().length, beforeDry, 'commit:false must not create state')

// State inspector returns human labels and v2 metadata.
response = await request({ type: 'macrolab:get_state' })
let alice = response.decisions.filter(({ state }) => state.macroName === 'backstory' && state.instance === 'alice')
assert.equal(alice.length, 3)
for (const item of alice) {
  assert.equal(item.state.version, 2)
  assert.equal(typeof item.state.label, 'string')
  assert(item.state.label.length > 1)
  assert.equal(typeof item.state.recipeHash, 'string')
}

// Reroll + undo is centralized persistent state behavior.
const pick = alice.find(({ state }) => state.kind === 'pick')
assert(pick)
const initialPickValue = pick.state.value
response = await request({ type: 'macrolab:decision_action', key: pick.key, action: 'reroll' })
assert.equal(response.type, 'macrolab:state')
let changedPick = response.decisions.find(({ key }) => key === pick.key)
assert(changedPick)
assert.notEqual(changedPick.state.value, initialPickValue)
assert.equal(changedPick.state.history.length, 1)
response = await request({ type: 'macrolab:decision_action', key: pick.key, action: 'undo' })
changedPick = response.decisions.find(({ key }) => key === pick.key)
assert.equal(changedPick.state.value, initialPickValue, 'undo should restore prior reroll value')

// Lock protects direct and bulk mutations.
response = await request({ type: 'macrolab:decision_action', key: pick.key, action: 'toggle_lock' })
assert.equal(response.decisions.find(({ key }) => key === pick.key).state.locked, true)
response = await request({ type: 'macrolab:decision_action', key: pick.key, action: 'reroll' })
assert.equal(response.type, 'macrolab:error')
assert.match(response.error, /locked/i)
response = await request({ type: 'macrolab:instance_action', macroName: 'backstory', instance: 'alice', action: 'reset' })
alice = response.decisions.filter(({ state }) => state.macroName === 'backstory' && state.instance === 'alice')
assert.equal(alice.length, 1, 'bulk reset leaves locked decisions alone')
assert.equal(alice[0].state.locked, true)

// Native variables remain a separate advanced surface.
response = await request({ type: 'macrolab:variable_action', scope: 'chat', action: 'set', key: 'weather', value: 'rain' })
assert.equal(response.variables.chat.weather, 'rain')
assert.equal(chatStore('chat-1').get('weather'), 'rain')
assert.equal(Object.keys(response.variables.chat).some((key) => key.startsWith('__macrolab_v2__')), false, 'internal decision vars are hidden from native variable list')

// Nested registered macros own independent state namespaces.
await request({ type: 'macrolab:save_macro', definition: { name: 'secret', description: '', body: 'Secret: {{pick::a debt::a prophecy}}' } })
await request({ type: 'macrolab:save_macro', definition: { name: 'profile', description: '', body: '{{secret::alice}} / Mood: {{pick::calm::restless}}' } })
const nested = await resolveTemplate('{{profile::alice}}', { chatId: 'chat-1', characterId: 'char-1', userId: 'user-1', commit: true })
assert(!nested.text.includes('{{'))
response = await request({ type: 'macrolab:get_state' })
assert(response.decisions.some(({ state }) => state.macroName === 'profile' && state.instance === 'alice'))
assert(response.decisions.some(({ state }) => state.macroName === 'secret' && state.instance === 'alice'))

// Decision IDs are context-derived rather than source ordinals: inserting a bare stochastic node before the body does not renumber existing descriptors.
const profileBefore = response.macros.find((macro) => macro.name === 'profile').decisions.map((decision) => decision.id)
response = await request({
  type: 'macrolab:save_macro',
  originalName: 'profile',
  definition: { name: 'profile', description: '', body: '{{pick::day::night}}\n{{secret::alice}} / Mood: {{pick::calm::restless}}' },
})
const profileAfter = response.macros.find((macro) => macro.name === 'profile').decisions.map((decision) => decision.id)
assert.equal(profileAfter.length, profileBefore.length + 1)
assert(profileAfter.includes(profileBefore[0]), 'existing decision ID should survive insertion of a prior stochastic node when static context is unchanged')

// Operator users share host-level macro names but not definitions or global variables.
response = await requestAs('user-2', { type: 'macrolab:get_state' })
assert.equal(response.macros.length, 0)
response = await requestAs('user-2', {
  type: 'macrolab:save_macro',
  definition: { name: 'backstory', description: 'User two', body: 'USER_TWO {{pick::orchard::desert}}' },
})
assert.equal(response.macros.length, 1)
const userTwo = await resolveTemplate('{{backstory::alice}}', { chatId: 'chat-2', characterId: 'char-2', userId: 'user-2', commit: false })
assert.match(userTwo.text, /^USER_TWO /)
const userOne = await resolveTemplate('{{backstory::alice}}', { chatId: 'chat-1', characterId: 'char-1', userId: 'user-1', commit: false })
assert(!userOne.text.startsWith('USER_TWO '))
await request({ type: 'macrolab:variable_action', scope: 'global', action: 'set', key: 'accent', value: 'pink' })
await requestAs('user-2', { type: 'macrolab:variable_action', scope: 'global', action: 'set', key: 'accent', value: 'green' })
assert.equal(globalStore('user-1').get('accent'), 'pink')
assert.equal(globalStore('user-2').get('accent'), 'green')

// Persisted state is URI-safe v2 JSON and carries UI metadata.
for (const [, raw] of decisionVars('chat-1')) {
  const state = parseDecision(raw)
  assert.equal(state.version, 2)
  assert.equal(typeof state.value, 'string')
  assert.equal(typeof state.locked, 'boolean')
  assert.equal(typeof state.label, 'string')
  assert.equal(typeof state.sourcePreview, 'string')
}

Math.random = originalRandom
console.log(`✓ MacroLab forge harness passed (${macroHandlers.size} registered handlers, ${decisionVars('chat-1').length} chat-1 v2 decisions)`)
