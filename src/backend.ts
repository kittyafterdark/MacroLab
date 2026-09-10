import { definitionFingerprint, fnv1a, instrumentMacroBody, scanDecisionDescriptors } from './core/decision-graph.js'
import {
  STATE_PREFIX,
  decisionKey,
  isInternalStateKey,
  parseDecision,
  pushHistory,
  serializeDecision,
  type DecisionState,
} from './core/state.js'
import type {
  DecisionActionRequest,
  FrontendRequest,
  InstanceActionRequest,
  MacroDefinition,
  MacroDefinitionView,
  MacroDiagnostic,
  SaveMacroRequest,
  VariableActionRequest,
  VariableSnapshot,
} from './shared/protocol.js'

declare const spindle: any

const REGISTRY_PATH = 'macro-registry.json'
const REGISTRY_NAME_INDEX_PATH = 'macro-name-index.json'
const OWNER_REGISTRY_KEY = '__owner__'
const INTERNAL_PICK = 'mlDecisionPickV2'
const INTERNAL_RANDOM = 'mlDecisionRandomV2'
const MAX_TEMPLATE_LENGTH = 500_000
const MAX_MACRO_BODY_LENGTH = 250_000
const MAX_MACRO_NAME_LENGTH = 64
const MAX_INSTANCE_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 500
const MACRO_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

type RegistryFile = {
  version: 1
  macros: MacroDefinition[]
}

type InvocationIds = {
  chatId: string
  characterId: string
  userId: string
}

const registries = new Map<string, Map<string, MacroDefinition>>()
const loadedRegistryUsers = new Set<string>()
const registeredUserMacroNames = new Set<string>()
const persistedMacroNames = new Set<string>()
let legacyRegistry: MacroDefinition[] = []
let legacyMigrationClaimed = false

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeVariableMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const normalized: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) normalized[key] = typeof entry === 'string' ? entry : String(entry ?? '')
  return normalized
}

function isFrontendRequest(payload: unknown): payload is FrontendRequest {
  return isRecord(payload) && typeof payload.type === 'string' && payload.type.startsWith('macrolab:') && typeof payload.requestId === 'string'
}

function decodeMeta(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function contextIds(ctx: any): InvocationIds {
  const chatId = String(ctx?.chatId ?? ctx?.env?.chat?.id ?? ctx?.env?.extra?.chatId ?? '')
  const characterId = String(ctx?.characterId ?? ctx?.env?.character?.id ?? ctx?.env?.extra?.characterId ?? '')
  const userId = String(ctx?.userId ?? ctx?.env?.extra?.userId ?? '')
  return { chatId, characterId, userId }
}

function normalizeInstance(args: unknown): string {
  const values = Array.isArray(args) ? args.map((value) => String(value ?? '')) : []
  const joined = values.join('::').trim()
  const instance = joined || 'default'
  return instance.length > MAX_INSTANCE_LENGTH ? instance.slice(0, MAX_INSTANCE_LENGTH) : instance
}

function randomIndex(length: number): number {
  if (length <= 1) return 0
  return Math.floor(Math.random() * length)
}

function differentRandomIndex(length: number, current: number | undefined): number {
  if (length <= 1) return 0
  if (typeof current !== 'number' || current < 0 || current >= length) return randomIndex(length)
  const offset = 1 + Math.floor(Math.random() * (length - 1))
  return (current + offset) % length
}

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  return Boolean(left) && left!.length === right.length && left!.every((value, index) => value === right[index])
}

function recipeHash(kind: 'pick' | 'random', values: string[]): string {
  return fnv1a(`${kind}\u0000${values.join('\u0000')}`)
}

function validateMacroDefinition(input: SaveMacroRequest['definition']): { name: string; description: string; body: string } {
  const name = String(input?.name ?? '').trim()
  const description = String(input?.description ?? '').trim()
  const body = String(input?.body ?? '')

  if (!name) throw new Error('Macro name is required.')
  if (name.length > MAX_MACRO_NAME_LENGTH) throw new Error(`Macro names are limited to ${MAX_MACRO_NAME_LENGTH} characters.`)
  if (!MACRO_NAME_RE.test(name)) throw new Error('Macro names must start with a letter and contain only letters, numbers, _ or -.')
  if (name === INTERNAL_PICK || name === INTERNAL_RANDOM || /^mlDecision/i.test(name)) throw new Error('That macro name is reserved by MacroLab.')
  if (name.toLowerCase() === 'pick' || name.toLowerCase() === 'random') throw new Error('pick and random are native macros and cannot be replaced by MacroLab.')
  if (!body.trim()) throw new Error('Macro body cannot be empty.')
  if (body.length > MAX_MACRO_BODY_LENGTH) throw new Error(`Macro bodies are limited to ${MAX_MACRO_BODY_LENGTH.toLocaleString()} characters.`)
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`Descriptions are limited to ${MAX_DESCRIPTION_LENGTH} characters.`)

  return { name, description, body }
}

async function readDecision(chatId: string, key: string, expected: { macroName: string; instance: string; decisionId: string }): Promise<DecisionState | null> {
  if (!chatId) return null
  const raw = await spindle.variables.chat.get(chatId, key)
  const state = parseDecision(raw)
  if (!state) return null
  if (state.macroName !== expected.macroName || state.instance !== expected.instance || state.decisionId !== expected.decisionId) return null
  return state
}

async function persistDecision(ctx: any, chatId: string, key: string, state: DecisionState): Promise<void> {
  if (!chatId || ctx?.commit === false) return
  await spindle.variables.chat.set(chatId, key, serializeDecision(state))
}

async function sampleNativeRandom(args: string[], context: Partial<InvocationIds> = {}): Promise<string> {
  const macro = `{{random${args.length ? `::${args.join('::')}` : ''}}}`
  try {
    const result = await spindle.macros.resolve(macro, {
      ...(context.chatId ? { chatId: context.chatId } : {}),
      ...(context.characterId ? { characterId: context.characterId } : {}),
      ...(context.userId ? { userId: context.userId } : {}),
      commit: false,
    })
    if (typeof result?.text === 'string' && result.text !== macro) return result.text
  } catch {
    // Fall through to a compact compatibility sampler.
  }

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

async function rerollNativeRandom(args: string[], previous: string, context: Partial<InvocationIds>): Promise<string> {
  let value = await sampleNativeRandom(args, context)
  for (let attempt = 0; attempt < 5 && value === previous; attempt += 1) value = await sampleNativeRandom(args, context)
  return value
}

function buildPickState(params: {
  previous: DecisionState | null
  macroName: string
  instance: string
  decisionId: string
  label: string
  sourcePreview: string
  options: string[]
  choiceIndex: number
  value: string
}): DecisionState {
  const timestamp = nowIso()
  const { previous } = params
  return {
    version: 2,
    macroName: params.macroName,
    instance: params.instance,
    decisionId: params.decisionId,
    kind: 'pick',
    label: params.label,
    sourcePreview: params.sourcePreview,
    value: params.value,
    locked: Boolean(previous?.locked),
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    revision: previous?.revision ?? 0,
    recipeHash: recipeHash('pick', params.options),
    choiceIndex: params.choiceIndex,
    optionCount: params.options.length,
    options: params.options,
    history: previous?.history,
  }
}

function buildRandomState(params: {
  previous: DecisionState | null
  macroName: string
  instance: string
  decisionId: string
  label: string
  sourcePreview: string
  args: string[]
  value: string
}): DecisionState {
  const timestamp = nowIso()
  const { previous } = params
  return {
    version: 2,
    macroName: params.macroName,
    instance: params.instance,
    decisionId: params.decisionId,
    kind: 'random',
    label: params.label,
    sourcePreview: params.sourcePreview,
    value: params.value,
    locked: Boolean(previous?.locked),
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    revision: previous?.revision ?? 0,
    recipeHash: recipeHash('random', params.args),
    args: params.args,
    history: previous?.history,
  }
}

function stateNeedsRefresh(previous: DecisionState | null, next: DecisionState): boolean {
  if (!previous) return true
  if (previous.kind !== next.kind || previous.value !== next.value || previous.label !== next.label || previous.sourcePreview !== next.sourcePreview) return true
  if (previous.recipeHash !== next.recipeHash) return true
  if (next.kind === 'pick' && (!sameStrings(previous.options, next.options ?? []) || previous.choiceIndex !== next.choiceIndex)) return true
  if (next.kind === 'random' && !sameStrings(previous.args, next.args ?? [])) return true
  return false
}

function registerInternalMacros(): void {
  spindle.registerMacro({
    name: INTERNAL_PICK,
    category: 'extension:macro_lab/internal',
    description: 'Internal sticky pick node used by MacroLab.',
    returnType: 'string',
    volatile: true,
    handler: async (ctx: any) => {
      const args = Array.isArray(ctx?.args) ? ctx.args.map((value: unknown) => String(value ?? '')) : []
      const macroName = decodeMeta(args[0], 'unknown')
      const instance = decodeMeta(args[1], 'default')
      const decisionId = decodeMeta(args[2], 'd_unknown')
      const label = decodeMeta(args[3], decisionId)
      const sourcePreview = decodeMeta(args[4], label)
      const options = args.slice(5)
      if (!options.length) return ''

      const { chatId } = contextIds(ctx)
      const key = decisionKey(macroName, instance, decisionId)
      const previous = await readDecision(chatId, key, { macroName, instance, decisionId })

      if (previous?.locked) return previous.value

      let choiceIndex: number
      const existingIndex = previous?.kind === 'pick' ? options.indexOf(previous.value) : -1
      if (existingIndex >= 0) choiceIndex = existingIndex
      else choiceIndex = randomIndex(options.length)
      const value = options[choiceIndex] ?? ''
      const next = buildPickState({ previous, macroName, instance, decisionId, label, sourcePreview, options, choiceIndex, value })

      if (stateNeedsRefresh(previous, next)) await persistDecision(ctx, chatId, key, next)
      return value
    },
  })

  spindle.registerMacro({
    name: INTERNAL_RANDOM,
    category: 'extension:macro_lab/internal',
    description: 'Internal sticky random node used by MacroLab.',
    returnType: 'string',
    volatile: true,
    handler: async (ctx: any) => {
      const args = Array.isArray(ctx?.args) ? ctx.args.map((value: unknown) => String(value ?? '')) : []
      const macroName = decodeMeta(args[0], 'unknown')
      const instance = decodeMeta(args[1], 'default')
      const decisionId = decodeMeta(args[2], 'd_unknown')
      const label = decodeMeta(args[3], decisionId)
      const sourcePreview = decodeMeta(args[4], label)
      const randomArgs = args.slice(5)
      const ids = contextIds(ctx)
      const key = decisionKey(macroName, instance, decisionId)
      const previous = await readDecision(ids.chatId, key, { macroName, instance, decisionId })

      if (previous) {
        if (!previous.locked) {
          const refreshed = buildRandomState({ previous, macroName, instance, decisionId, label, sourcePreview, args: randomArgs, value: previous.value })
          if (stateNeedsRefresh(previous, refreshed)) await persistDecision(ctx, ids.chatId, key, refreshed)
        }
        return previous.value
      }

      const value = await sampleNativeRandom(randomArgs, ids)
      const next = buildRandomState({ previous: null, macroName, instance, decisionId, label, sourcePreview, args: randomArgs, value })
      await persistDecision(ctx, ids.chatId, key, next)
      return value
    },
  })
}

function registryKey(userId: string): string {
  return userId || OWNER_REGISTRY_KEY
}

function registryForKey(key: string): Map<string, MacroDefinition> {
  let registry = registries.get(key)
  if (!registry) {
    registry = new Map<string, MacroDefinition>()
    registries.set(key, registry)
  }
  return registry
}

function registryForUser(userId: string): Map<string, MacroDefinition> {
  return registryForKey(registryKey(userId))
}

function resolveRegistryKeyFromContext(ctx: any): string | null {
  const explicitUserId = contextIds(ctx).userId
  if (explicitUserId) return registryKey(explicitUserId)
  if (registries.has(OWNER_REGISTRY_KEY)) return OWNER_REGISTRY_KEY
  if (registries.size === 1) return registries.keys().next().value ?? null
  return null
}

function registerUserMacro(name: string): void {
  if (registeredUserMacroNames.has(name)) return
  spindle.registerMacro({
    name,
    category: 'extension:macro_lab',
    description: `Registered in MacroLab. Use {{${name}}} or {{${name}::instance}}.`,
    returnType: 'string',
    volatile: true,
    handler: async (ctx: any) => {
      const explicitUserId = contextIds(ctx).userId
      if (explicitUserId) await ensureRegistryLoaded(explicitUserId)
      const key = resolveRegistryKeyFromContext(ctx)
      if (!key) return ''
      const definition = registryForKey(key).get(name)
      if (!definition) return ''
      const instance = normalizeInstance(ctx?.args)
      return instrumentMacroBody(definition.body, name, instance, { pick: INTERNAL_PICK, random: INTERNAL_RANDOM })
    },
  })
  registeredUserMacroNames.add(name)
}

function normalizeStoredRegistry(stored: any): MacroDefinition[] {
  const normalized: MacroDefinition[] = []
  const macros = Array.isArray(stored?.macros) ? stored.macros : []
  for (const raw of macros) {
    try {
      const checked = validateMacroDefinition(raw)
      const createdAt = typeof raw?.createdAt === 'string' ? raw.createdAt : nowIso()
      const updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : createdAt
      normalized.push({ ...checked, createdAt, updatedAt })
    } catch (error) {
      spindle.log.warn(`Skipped invalid stored macro: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return normalized
}

async function persistNameIndex(): Promise<void> {
  await spindle.storage.setJson(REGISTRY_NAME_INDEX_PATH, { version: 1, names: [...persistedMacroNames].sort((a, b) => a.localeCompare(b)) }, { indent: 2 })
}

async function addMacroNameToIndex(name: string): Promise<void> {
  if (persistedMacroNames.has(name)) return
  persistedMacroNames.add(name)
  await persistNameIndex()
}

async function persistRegistry(userId: string): Promise<void> {
  const payload: RegistryFile = {
    version: 1,
    macros: [...registryForUser(userId).values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
  await spindle.userStorage.setJson(REGISTRY_PATH, payload, { indent: 2, ...(userId ? { userId } : {}) })
}

async function ensureRegistryLoaded(userId: string): Promise<void> {
  const key = registryKey(userId)
  if (loadedRegistryUsers.has(key)) return

  const stored = await spindle.userStorage.getJson(REGISTRY_PATH, {
    fallback: { version: 1, macros: [] } satisfies RegistryFile,
    ...(userId ? { userId } : {}),
  })
  let definitions = normalizeStoredRegistry(stored)

  // v1 stored macro definitions are worth preserving. v1 decision state is intentionally
  // not migrated: v2 uses a new namespace and direct host persistence semantics.
  if (!definitions.length && legacyRegistry.length && !legacyMigrationClaimed) {
    legacyMigrationClaimed = true
    definitions = legacyRegistry.map((definition) => ({ ...definition }))
  }

  const registry = registryForKey(key)
  registry.clear()
  for (const definition of definitions) {
    registry.set(definition.name, definition)
    await addMacroNameToIndex(definition.name)
    try {
      registerUserMacro(definition.name)
    } catch (error) {
      registry.delete(definition.name)
      spindle.log.warn(`Could not register stored macro ${definition.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  loadedRegistryUsers.add(key)

  if (legacyMigrationClaimed && legacyRegistry.length && definitions.length) {
    await persistRegistry(userId)
    legacyRegistry = []
    await spindle.storage.setJson(REGISTRY_PATH, { version: 1, macros: [] } satisfies RegistryFile, { indent: 2 })
  }
}

async function loadRegistryBootstrap(): Promise<void> {
  const [nameIndex, legacy] = await Promise.all([
    spindle.storage.getJson(REGISTRY_NAME_INDEX_PATH, { fallback: { version: 1, names: [] } }),
    spindle.storage.getJson(REGISTRY_PATH, { fallback: { version: 1, macros: [] } satisfies RegistryFile }),
  ])

  for (const rawName of Array.isArray(nameIndex?.names) ? nameIndex.names : []) {
    const name = String(rawName ?? '').trim()
    if (MACRO_NAME_RE.test(name) && name !== INTERNAL_PICK && name !== INTERNAL_RANDOM) persistedMacroNames.add(name)
  }

  legacyRegistry = normalizeStoredRegistry(legacy)
  for (const definition of legacyRegistry) persistedMacroNames.add(definition.name)
  if (legacyRegistry.length) await persistNameIndex()

  for (const name of persistedMacroNames) {
    try {
      registerUserMacro(name)
    } catch (error) {
      spindle.log.warn(`Could not register indexed macro ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    await ensureRegistryLoaded('')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/userId.*required.*operator-scoped/i.test(message)) spindle.log.warn(`Could not preload owner registry: ${message}`)
  }
}

async function initialize(): Promise<void> {
  registerInternalMacros()
  await loadRegistryBootstrap()
  spindle.log.info(`MacroLab 2 forge loaded (${registeredUserMacroNames.size} registered macro name${registeredUserMacroNames.size === 1 ? '' : 's'})`)
}

const ready = initialize()

async function globalVariablesList(userId: string): Promise<Record<string, string>> {
  return normalizeVariableMap(await spindle.variables.global.list(userId))
}

async function globalVariableSet(userId: string, key: string, value: string): Promise<void> {
  await spindle.variables.global.set(key, value, userId)
}

async function globalVariableDelete(userId: string, key: string): Promise<void> {
  await spindle.variables.global.delete(key, userId)
}

function publicVariables(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !isInternalStateKey(key)))
}

async function activeContext(userId: string): Promise<{
  activeChat: any
  variables: VariableSnapshot
  decisions: Array<{ key: string; state: DecisionState }>
}> {
  const activeChat = await spindle.chats.getActive(userId)
  const [chatRaw, localRaw, globalRaw] = await Promise.all([
    activeChat?.id ? spindle.variables.chat.list(activeChat.id) : Promise.resolve({}),
    activeChat?.id ? spindle.variables.local.list(activeChat.id) : Promise.resolve({}),
    globalVariablesList(userId),
  ])
  const chat = normalizeVariableMap(chatRaw)
  const local = normalizeVariableMap(localRaw)
  const decisions: Array<{ key: string; state: DecisionState }> = []
  for (const [key, raw] of Object.entries(chat)) {
    if (!key.startsWith(STATE_PREFIX)) continue
    const state = parseDecision(raw)
    if (state) decisions.push({ key, state })
  }
  decisions.sort((a, b) => {
    const left = `${a.state.macroName}\u0000${a.state.instance}\u0000${a.state.label}\u0000${a.state.decisionId}`
    const right = `${b.state.macroName}\u0000${b.state.instance}\u0000${b.state.label}\u0000${b.state.decisionId}`
    return left.localeCompare(right)
  })
  return {
    activeChat,
    variables: { chat: publicVariables(chat), local: publicVariables(local), global: publicVariables(globalRaw) },
    decisions,
  }
}

function macroViews(userId: string): MacroDefinitionView[] {
  return [...registryForUser(userId).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((definition) => ({
      ...definition,
      fingerprint: definitionFingerprint(definition.body),
      decisions: scanDecisionDescriptors(definition.body),
    }))
}

async function sendState(userId: string, requestId: string, notice = ''): Promise<void> {
  const { activeChat, variables, decisions } = await activeContext(userId)
  spindle.sendToFrontend({
    type: 'macrolab:state',
    requestId,
    notice,
    macros: macroViews(userId),
    decisions,
    variables,
    context: activeChat
      ? {
          id: String(activeChat.id),
          name: typeof activeChat.name === 'string' && activeChat.name.trim() ? activeChat.name : 'Active chat',
          hasCharacter: Boolean(activeChat.character_id),
        }
      : null,
  }, userId)
}

async function saveMacro(userId: string, request: SaveMacroRequest): Promise<string> {
  await ensureRegistryLoaded(userId)
  const checked = validateMacroDefinition(request.definition)
  const originalName = String(request.originalName ?? '').trim()
  const registry = registryForUser(userId)
  const priorOriginal = originalName ? registry.get(originalName) : undefined
  const priorTarget = registry.get(checked.name)

  if (priorTarget && originalName && originalName !== checked.name) throw new Error(`A MacroLab macro named “${checked.name}” already exists.`)
  if (priorTarget && !originalName) throw new Error(`A MacroLab macro named “${checked.name}” already exists.`)

  registerUserMacro(checked.name)

  const timestamp = nowIso()
  const next: MacroDefinition = {
    ...checked,
    createdAt: priorOriginal?.createdAt ?? priorTarget?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }

  if (originalName && originalName !== checked.name) registry.delete(originalName)
  registry.set(checked.name, next)

  try {
    await persistRegistry(userId)
    await addMacroNameToIndex(checked.name)
  } catch (error) {
    registry.delete(checked.name)
    if (priorOriginal) registry.set(priorOriginal.name, priorOriginal)
    else if (priorTarget) registry.set(priorTarget.name, priorTarget)
    throw error
  }

  const decisions = scanDecisionDescriptors(next.body).length
  return `Saved {{${next.name}}}${decisions ? ` with ${decisions} sticky decision${decisions === 1 ? '' : 's'}` : ''}.`
}

async function deleteMacro(userId: string, name: string): Promise<string> {
  await ensureRegistryLoaded(userId)
  const registry = registryForUser(userId)
  if (!registry.has(name)) throw new Error(`No MacroLab macro named “${name}” exists.`)
  registry.delete(name)
  await persistRegistry(userId)

  const { activeChat } = await activeContext(userId)
  if (activeChat?.id) {
    const chatVariables = normalizeVariableMap(await spindle.variables.chat.list(activeChat.id))
    for (const [key, raw] of Object.entries(chatVariables)) {
      if (!key.startsWith(STATE_PREFIX)) continue
      const state = parseDecision(raw)
      if (state?.macroName === name) await spindle.variables.chat.delete(activeChat.id, key)
    }
  }
  return `Deleted {{${name}}} and its v2 state in the active chat.`
}

async function decisionAction(userId: string, request: DecisionActionRequest): Promise<string> {
  if (!request.key.startsWith(STATE_PREFIX)) throw new Error('Invalid MacroLab decision key.')
  const activeChat = await spindle.chats.getActive(userId)
  if (!activeChat?.id) throw new Error('Open a chat first; Hot Plate state is stored per chat.')
  const raw = await spindle.variables.chat.get(activeChat.id, request.key)
  const state = parseDecision(raw)
  if (!state) throw new Error('That decision no longer exists.')

  if (request.action === 'toggle_lock') {
    const next: DecisionState = { ...state, locked: !state.locked, updatedAt: nowIso(), revision: state.revision + 1 }
    await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next))
    return `${next.locked ? 'Locked' : 'Unlocked'} ${state.label}.`
  }

  if (state.locked) throw new Error('That decision is locked. Unlock it first.')

  if (request.action === 'reset') {
    await spindle.variables.chat.delete(activeChat.id, request.key)
    return `Reset ${state.label}; it will roll again on the next committing resolve.`
  }

  if (request.action === 'undo') {
    const history = [...(state.history ?? [])]
    const previous = history.pop()
    if (!previous) throw new Error('No earlier reroll is available for this decision.')
    const next: DecisionState = {
      ...state,
      value: previous.value,
      choiceIndex: previous.choiceIndex,
      history,
      updatedAt: nowIso(),
      revision: state.revision + 1,
    }
    await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next))
    return `Restored ${state.label}: ${next.value || '∅'}.`
  }

  let next: DecisionState
  if (state.kind === 'pick') {
    const options = state.options ?? []
    if (!options.length) throw new Error('This choice has no saved option recipe yet. Resolve it once, then reroll.')
    const currentIndex = options.indexOf(state.value)
    const index = differentRandomIndex(options.length, currentIndex >= 0 ? currentIndex : state.choiceIndex)
    next = {
      ...state,
      value: options[index] ?? '',
      choiceIndex: index,
      optionCount: options.length,
      history: pushHistory(state),
      updatedAt: nowIso(),
      revision: state.revision + 1,
    }
  } else {
    const value = await rerollNativeRandom(state.args ?? [], state.value, {
      chatId: activeChat.id,
      characterId: activeChat.character_id || undefined,
      userId,
    })
    next = {
      ...state,
      value,
      history: pushHistory(state),
      updatedAt: nowIso(),
      revision: state.revision + 1,
    }
  }

  await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next))
  return `Rerolled ${state.label}: ${state.value || '∅'} → ${next.value || '∅'}`
}

async function instanceAction(userId: string, request: InstanceActionRequest): Promise<string> {
  const activeChat = await spindle.chats.getActive(userId)
  if (!activeChat?.id) throw new Error('Open a chat first; Hot Plate state is stored per chat.')
  const chatVariables = normalizeVariableMap(await spindle.variables.chat.list(activeChat.id))
  let changed = 0
  let locked = 0

  for (const [key, raw] of Object.entries(chatVariables)) {
    if (!key.startsWith(STATE_PREFIX)) continue
    const state = parseDecision(raw)
    if (!state || state.macroName !== request.macroName || state.instance !== request.instance) continue
    if (state.locked) {
      locked += 1
      continue
    }

    if (request.action === 'reset') {
      await spindle.variables.chat.delete(activeChat.id, key)
      changed += 1
      continue
    }

    let next: DecisionState | null = null
    if (state.kind === 'pick') {
      const options = state.options ?? []
      if (options.length) {
        const currentIndex = options.indexOf(state.value)
        const index = differentRandomIndex(options.length, currentIndex >= 0 ? currentIndex : state.choiceIndex)
        next = {
          ...state,
          value: options[index] ?? '',
          choiceIndex: index,
          optionCount: options.length,
          history: pushHistory(state),
          updatedAt: nowIso(),
          revision: state.revision + 1,
        }
      }
    } else {
      const value = await rerollNativeRandom(state.args ?? [], state.value, {
        chatId: activeChat.id,
        characterId: activeChat.character_id || undefined,
        userId,
      })
      next = {
        ...state,
        value,
        history: pushHistory(state),
        updatedAt: nowIso(),
        revision: state.revision + 1,
      }
    }

    if (next) {
      await spindle.variables.chat.set(activeChat.id, key, serializeDecision(next))
      changed += 1
    }
  }

  const verb = request.action === 'reroll' ? 'Rerolled' : 'Reset'
  const suffix = locked ? ` ${locked} locked decision${locked === 1 ? '' : 's'} stayed put.` : ''
  return `${verb} ${changed} decision${changed === 1 ? '' : 's'} in ${request.macroName} · ${request.instance}.${suffix}`
}

async function variableAction(userId: string, request: VariableActionRequest): Promise<string> {
  const key = String(request.key ?? '').trim()
  if (!key) throw new Error('Variable name is required.')
  if (isInternalStateKey(key)) throw new Error('MacroLab decision variables are managed from Hot Plate / State.')

  const activeChat = request.scope === 'global' ? null : await spindle.chats.getActive(userId)
  if (request.scope !== 'global' && !activeChat?.id) throw new Error('Open a chat first to edit chat/local variables.')

  if (request.action === 'delete') {
    if (request.scope === 'global') await globalVariableDelete(userId, key)
    else await spindle.variables[request.scope].delete(activeChat.id, key)
    return `Deleted ${request.scope} variable ${key}.`
  }

  const value = String(request.value ?? '')
  if (request.scope === 'global') await globalVariableSet(userId, key, value)
  else await spindle.variables[request.scope].set(activeChat.id, key, value)
  return `Updated ${request.scope} variable ${key}.`
}

spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
  if (!isFrontendRequest(payload)) return
  const request = payload as FrontendRequest

  try {
    await ready
    await ensureRegistryLoaded(userId)

    if (request.type === 'macrolab:resolve') {
      if (request.template.length > MAX_TEMPLATE_LENGTH) throw new Error(`Input is too large. Preview is limited to ${MAX_TEMPLATE_LENGTH.toLocaleString()} characters.`)
      const { activeChat, variables } = await activeContext(userId)
      const options: { chatId?: string; characterId?: string; userId: string; commit: false } = { userId, commit: false }
      if (activeChat?.id) options.chatId = activeChat.id
      if (activeChat?.character_id) options.characterId = activeChat.character_id
      const result = await spindle.macros.resolve(request.template, options)
      const diagnostics: MacroDiagnostic[] = Array.isArray(result?.diagnostics) ? result.diagnostics : []
      spindle.sendToFrontend({
        type: 'macrolab:result',
        requestId: request.requestId,
        text: typeof result?.text === 'string' ? result.text : '',
        diagnostics,
        context: activeChat
          ? {
              id: String(activeChat.id),
              name: typeof activeChat.name === 'string' && activeChat.name.trim() ? activeChat.name : 'Active chat',
              hasCharacter: Boolean(activeChat.character_id),
              variables,
            }
          : null,
      }, userId)
      return
    }

    if (request.type === 'macrolab:get_state') {
      await sendState(userId, request.requestId)
      return
    }

    if (request.type === 'macrolab:save_macro') {
      await sendState(userId, request.requestId, await saveMacro(userId, request))
      return
    }

    if (request.type === 'macrolab:delete_macro') {
      await sendState(userId, request.requestId, await deleteMacro(userId, String(request.name ?? '').trim()))
      return
    }

    if (request.type === 'macrolab:decision_action') {
      await sendState(userId, request.requestId, await decisionAction(userId, request))
      return
    }

    if (request.type === 'macrolab:instance_action') {
      await sendState(userId, request.requestId, await instanceAction(userId, request))
      return
    }

    if (request.type === 'macrolab:variable_action') {
      await sendState(userId, request.requestId, await variableAction(userId, request))
      return
    }
  } catch (error) {
    spindle.sendToFrontend({
      type: 'macrolab:error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    }, userId)
  }
})
