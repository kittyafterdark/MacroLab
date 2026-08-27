"use strict";
const REGISTRY_PATH = 'macro-registry.json';
const REGISTRY_NAME_INDEX_PATH = 'macro-name-index.json';
const OWNER_REGISTRY_KEY = '__owner__';
const STATE_PREFIX = '__lml_state__';
const INTERNAL_PICK = 'lmlDecisionPick';
const INTERNAL_RANDOM = 'lmlDecisionRandom';
const MAX_TEMPLATE_LENGTH = 500_000;
const MAX_MACRO_BODY_LENGTH = 250_000;
const MAX_MACRO_NAME_LENGTH = 64;
const MAX_INSTANCE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 500;
const MACRO_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const registries = new Map();
const loadedRegistryUsers = new Set();
const registeredUserMacroNames = new Set();
const persistedMacroNames = new Set();
let legacyRegistry = [];
let legacyMigrationClaimed = false;
const liveDecisionCache = new Map();
function nowIso() {
    return new Date().toISOString();
}
function normalizeVariableMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
        normalized[key] = typeof entry === 'string' ? entry : String(entry ?? '');
    }
    return normalized;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isFrontendRequest(payload) {
    if (!isRecord(payload) || typeof payload.type !== 'string' || typeof payload.requestId !== 'string') {
        return false;
    }
    return payload.type.startsWith('lumi_macro_lab:');
}
function validateMacroDefinition(input) {
    const name = String(input?.name ?? '').trim();
    const description = String(input?.description ?? '').trim();
    const body = String(input?.body ?? '');
    if (!name)
        throw new Error('Macro name is required.');
    if (name.length > MAX_MACRO_NAME_LENGTH) {
        throw new Error(`Macro names are limited to ${MAX_MACRO_NAME_LENGTH} characters.`);
    }
    if (!MACRO_NAME_RE.test(name)) {
        throw new Error('Macro names must start with a letter and contain only letters, numbers, _ or -.');
    }
    if (name === INTERNAL_PICK || name === INTERNAL_RANDOM || name.startsWith('lmlDecision')) {
        throw new Error('That macro name is reserved by Lumi Macro Lab.');
    }
    if (name.toLowerCase() === 'pick' || name.toLowerCase() === 'random') {
        throw new Error('pick and random are native Lumi macros and cannot be replaced by Macro Lab.');
    }
    if (!body.trim())
        throw new Error('Macro body cannot be empty.');
    if (body.length > MAX_MACRO_BODY_LENGTH) {
        throw new Error(`Macro bodies are limited to ${MAX_MACRO_BODY_LENGTH.toLocaleString()} characters.`);
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
        throw new Error(`Descriptions are limited to ${MAX_DESCRIPTION_LENGTH} characters.`);
    }
    return { name, description, body };
}
function encodeMeta(value) {
    return encodeURIComponent(value);
}
function decodeMeta(value, fallback) {
    if (!value)
        return fallback;
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
function normalizeInstance(args) {
    const values = Array.isArray(args) ? args.map((value) => String(value ?? '')) : [];
    const joined = values.join('::').trim();
    const instance = joined || 'default';
    return instance.length > MAX_INSTANCE_LENGTH ? instance.slice(0, MAX_INSTANCE_LENGTH) : instance;
}
function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
function decisionKey(macroName, instance, decisionId) {
    return `${STATE_PREFIX}${fnv1a(`${macroName}\u0000${instance}`)}_${decisionId}`;
}
function cacheKey(chatId, key) {
    return `${chatId}\u0000${key}`;
}
function serializeDecision(state) {
    return encodeURIComponent(JSON.stringify(state));
}
function parseDecision(value) {
    if (typeof value !== 'string' || !value)
        return null;
    try {
        let source = value;
        if (!source.trim().startsWith('{')) {
            try {
                source = decodeURIComponent(source);
            }
            catch {
                // Backward/foreign values may already be plain JSON.
            }
        }
        const parsed = JSON.parse(source);
        if (parsed.version !== 1 ||
            typeof parsed.macroName !== 'string' ||
            typeof parsed.instance !== 'string' ||
            typeof parsed.decisionId !== 'string' ||
            (parsed.kind !== 'pick' && parsed.kind !== 'random') ||
            typeof parsed.value !== 'string') {
            return null;
        }
        return {
            version: 1,
            macroName: parsed.macroName,
            instance: parsed.instance,
            decisionId: parsed.decisionId,
            kind: parsed.kind,
            value: parsed.value,
            locked: Boolean(parsed.locked),
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
            choiceIndex: typeof parsed.choiceIndex === 'number' ? parsed.choiceIndex : undefined,
            optionCount: typeof parsed.optionCount === 'number' ? parsed.optionCount : undefined,
            options: Array.isArray(parsed.options) ? parsed.options.map((entry) => String(entry ?? '')) : undefined,
            args: Array.isArray(parsed.args) ? parsed.args.map((entry) => String(entry ?? '')) : undefined,
        };
    }
    catch {
        return null;
    }
}
function readEnvChatVariable(ctx, key) {
    const vars = ctx?.env?.variables?.chat;
    if (!vars)
        return undefined;
    try {
        if (typeof vars.get === 'function') {
            const value = vars.get(key);
            return value == null ? undefined : String(value);
        }
        if (isRecord(vars) && key in vars)
            return String(vars[key] ?? '');
    }
    catch {
        // Environment mirrors can be read-only/proxied. Cache + native storage is our fallback.
    }
    return undefined;
}
function writeEnvChatVariable(ctx, key, value) {
    const vars = ctx?.env?.variables?.chat;
    if (!vars)
        return;
    try {
        if (value === null && typeof vars.delete === 'function')
            vars.delete(key);
        else if (value !== null && typeof vars.set === 'function')
            vars.set(key, value);
        else if (isRecord(vars)) {
            if (value === null)
                delete vars[key];
            else
                vars[key] = value;
        }
    }
    catch {
        // Best effort only; Spindle's native variable API remains authoritative.
    }
}
function contextIds(ctx) {
    const chatId = String(ctx?.env?.chat?.id ?? ctx?.env?.extra?.chatId ?? '');
    const characterId = String(ctx?.env?.character?.id ?? ctx?.env?.extra?.characterId ?? '');
    const userId = String(ctx?.env?.extra?.userId ?? ctx?.userId ?? '');
    return { chatId, characterId, userId };
}
function randomIndex(length) {
    if (length <= 1)
        return 0;
    return Math.floor(Math.random() * length);
}
function differentRandomIndex(length, current) {
    if (length <= 1)
        return 0;
    if (typeof current !== 'number' || current < 0 || current >= length)
        return randomIndex(length);
    const offset = 1 + Math.floor(Math.random() * (length - 1));
    return (current + offset) % length;
}
function sameStringArray(left, right) {
    return Boolean(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function instrumentBody(body, macroName, instance) {
    let ordinal = 0;
    const encodedMacro = encodeMeta(macroName);
    const encodedInstance = encodeMeta(instance);
    return body.replace(/{{\s*(pick|random)(?=\s*(?:::|}}))/gi, (_match, rawKind) => {
        const kind = rawKind.toLowerCase() === 'pick' ? INTERNAL_PICK : INTERNAL_RANDOM;
        const decisionId = `d${ordinal}`;
        ordinal += 1;
        return `{{${kind}::${encodedMacro}::${encodedInstance}::${decisionId}`;
    });
}
function decisionFromContext(ctx, key, expected) {
    const { chatId } = contextIds(ctx);
    const fromEnv = parseDecision(readEnvChatVariable(ctx, key));
    const fromCache = chatId ? liveDecisionCache.get(cacheKey(chatId, key)) ?? null : null;
    const decision = fromEnv ?? fromCache;
    if (!decision)
        return null;
    if (decision.macroName !== expected.macroName ||
        decision.instance !== expected.instance ||
        decision.decisionId !== expected.decisionId) {
        return null;
    }
    return decision;
}
function stageDecisionWrite(ctx, key, decision) {
    const { chatId } = contextIds(ctx);
    if (!chatId)
        return '';
    const serialized = serializeDecision(decision);
    // Let Lumi mutate the current macro environment itself. Returning setchatvar
    // keeps the write in the same evaluator pass, so prompt assembly owns the
    // final flush and commit:false remains genuinely non-persistent.
    writeEnvChatVariable(ctx, key, serialized);
    if (ctx?.commit !== false)
        liveDecisionCache.set(cacheKey(chatId, key), decision);
    return `{{setchatvar::${key}::${serialized}}}`;
}
async function sampleNativeRandom(args, context = {}) {
    const macro = `{{random${args.length ? `::${args.join('::')}` : ''}}}`;
    try {
        const result = await spindle.macros.resolve(macro, {
            ...(context.chatId ? { chatId: context.chatId } : {}),
            ...(context.characterId ? { characterId: context.characterId } : {}),
            ...(context.userId ? { userId: context.userId } : {}),
            commit: false,
        });
        if (typeof result?.text === 'string' && result.text !== macro)
            return result.text;
    }
    catch {
        // Fall through to a small compatibility sampler.
    }
    if (args.length >= 2) {
        const low = Number(args[0]);
        const high = Number(args[1]);
        if (Number.isFinite(low) && Number.isFinite(high)) {
            const min = Math.min(low, high);
            const max = Math.max(low, high);
            if (Number.isInteger(min) && Number.isInteger(max)) {
                return String(min + Math.floor(Math.random() * (max - min + 1)));
            }
            return String(min + Math.random() * (max - min));
        }
    }
    return String(Math.random());
}
async function rerollNativeRandom(args, previous, context) {
    let value = await sampleNativeRandom(args, context);
    for (let attempt = 0; attempt < 4 && value === previous; attempt += 1) {
        value = await sampleNativeRandom(args, context);
    }
    return value;
}
function registerInternalMacros() {
    spindle.registerMacro({
        name: INTERNAL_PICK,
        category: 'extension:lumi_macro_lab/internal',
        description: 'Internal sticky pick node used by Lumi Macro Lab.',
        returnType: 'string',
        volatile: true,
        handler: async (ctx) => {
            const args = Array.isArray(ctx?.args) ? ctx.args.map((value) => String(value ?? '')) : [];
            const macroName = decodeMeta(args[0], 'unknown');
            const instance = decodeMeta(args[1], 'default');
            const decisionId = args[2] || 'd0';
            const options = args.slice(3);
            if (!options.length)
                return '';
            const key = decisionKey(macroName, instance, decisionId);
            const expected = { macroName, instance, decisionId };
            const previous = decisionFromContext(ctx, key, expected);
            let choiceIndex = previous?.kind === 'pick' ? previous.choiceIndex : undefined;
            if (typeof choiceIndex !== 'number' || choiceIndex < 0 || choiceIndex >= options.length) {
                choiceIndex = randomIndex(options.length);
            }
            const value = options[choiceIndex] ?? '';
            if (!previous || previous.kind !== 'pick' || !sameStringArray(previous.options, options) || previous.value !== value) {
                const next = {
                    version: 1,
                    macroName,
                    instance,
                    decisionId,
                    kind: 'pick',
                    value,
                    locked: Boolean(previous?.locked),
                    updatedAt: nowIso(),
                    choiceIndex,
                    optionCount: options.length,
                    options,
                };
                return `${stageDecisionWrite(ctx, key, next)}${value}`;
            }
            return value;
        },
    });
    spindle.registerMacro({
        name: INTERNAL_RANDOM,
        category: 'extension:lumi_macro_lab/internal',
        description: 'Internal sticky random node used by Lumi Macro Lab.',
        returnType: 'string',
        volatile: true,
        handler: async (ctx) => {
            const args = Array.isArray(ctx?.args) ? ctx.args.map((value) => String(value ?? '')) : [];
            const macroName = decodeMeta(args[0], 'unknown');
            const instance = decodeMeta(args[1], 'default');
            const decisionId = args[2] || 'd0';
            const randomArgs = args.slice(3);
            const key = decisionKey(macroName, instance, decisionId);
            const expected = { macroName, instance, decisionId };
            const previous = decisionFromContext(ctx, key, expected);
            if (previous?.kind === 'random') {
                if (sameStringArray(previous.args, randomArgs))
                    return previous.value;
                const refreshed = { ...previous, args: randomArgs, updatedAt: nowIso() };
                return `${stageDecisionWrite(ctx, key, refreshed)}${previous.value}`;
            }
            const ids = contextIds(ctx);
            const value = await sampleNativeRandom(randomArgs, ids);
            const next = {
                version: 1,
                macroName,
                instance,
                decisionId,
                kind: 'random',
                value,
                locked: false,
                updatedAt: nowIso(),
                args: randomArgs,
            };
            return `${stageDecisionWrite(ctx, key, next)}${value}`;
        },
    });
}
function registryKey(userId) {
    return userId || OWNER_REGISTRY_KEY;
}
function registryForKey(key) {
    let registry = registries.get(key);
    if (!registry) {
        registry = new Map();
        registries.set(key, registry);
    }
    return registry;
}
function registryForUser(userId) {
    return registryForKey(registryKey(userId));
}
function resolveRegistryKeyFromContext(ctx) {
    const explicitUserId = contextIds(ctx).userId;
    if (explicitUserId)
        return registryKey(explicitUserId);
    if (registries.has(OWNER_REGISTRY_KEY))
        return OWNER_REGISTRY_KEY;
    if (registries.size === 1)
        return registries.keys().next().value ?? null;
    return null;
}
function registerUserMacro(name) {
    if (registeredUserMacroNames.has(name))
        return;
    spindle.registerMacro({
        name,
        category: 'extension:lumi_macro_lab',
        description: `Registered in Lumi Macro Lab. Use {{${name}}} or {{${name}::instance}}.`,
        returnType: 'string',
        volatile: true,
        handler: async (ctx) => {
            const explicitUserId = contextIds(ctx).userId;
            if (explicitUserId)
                await ensureRegistryLoaded(explicitUserId);
            const key = resolveRegistryKeyFromContext(ctx);
            if (!key)
                return '';
            const definition = registryForKey(key).get(name);
            if (!definition)
                return '';
            const instance = normalizeInstance(ctx?.args);
            return instrumentBody(definition.body, name, instance);
        },
    });
    registeredUserMacroNames.add(name);
}
async function persistNameIndex() {
    await spindle.storage.setJson(REGISTRY_NAME_INDEX_PATH, { version: 1, names: [...persistedMacroNames].sort((a, b) => a.localeCompare(b)) }, { indent: 2 });
}
async function addMacroNameToIndex(name) {
    if (persistedMacroNames.has(name))
        return;
    persistedMacroNames.add(name);
    await persistNameIndex();
}
async function persistRegistry(userId) {
    const registry = registryForUser(userId);
    const payload = {
        version: 1,
        macros: [...registry.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    await spindle.userStorage.setJson(REGISTRY_PATH, payload, {
        indent: 2,
        ...(userId ? { userId } : {}),
    });
}
function normalizeStoredRegistry(stored) {
    const normalized = [];
    const macros = Array.isArray(stored?.macros) ? stored.macros : [];
    for (const raw of macros) {
        try {
            const checked = validateMacroDefinition(raw);
            const createdAt = typeof raw?.createdAt === 'string' ? raw.createdAt : nowIso();
            const updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : createdAt;
            normalized.push({ ...checked, createdAt, updatedAt });
        }
        catch (error) {
            spindle.log.warn(`Skipped invalid stored macro: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return normalized;
}
async function ensureRegistryLoaded(userId) {
    const key = registryKey(userId);
    if (loadedRegistryUsers.has(key))
        return;
    const stored = await spindle.userStorage.getJson(REGISTRY_PATH, {
        fallback: { version: 1, macros: [] },
        ...(userId ? { userId } : {}),
    });
    let definitions = normalizeStoredRegistry(stored);
    // 1.1.0 stored definitions in extension-wide storage. Claim that legacy file once
    // and migrate it into the first real user's isolated storage. This avoids both
    // losing a tester's macros and copying private definitions to every operator user.
    if (!definitions.length && legacyRegistry.length && !legacyMigrationClaimed) {
        legacyMigrationClaimed = true;
        definitions = legacyRegistry.map((definition) => ({ ...definition }));
    }
    const registry = registryForKey(key);
    registry.clear();
    for (const definition of definitions) {
        registry.set(definition.name, definition);
        await addMacroNameToIndex(definition.name);
        try {
            registerUserMacro(definition.name);
        }
        catch (error) {
            registry.delete(definition.name);
            spindle.log.warn(`Could not register stored macro ${definition.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    loadedRegistryUsers.add(key);
    if (legacyMigrationClaimed && legacyRegistry.length && definitions.length) {
        await persistRegistry(userId);
        legacyRegistry = [];
        await spindle.storage.setJson(REGISTRY_PATH, { version: 1, macros: [] }, { indent: 2 });
    }
}
async function loadRegistryBootstrap() {
    const [nameIndex, legacy] = await Promise.all([
        spindle.storage.getJson(REGISTRY_NAME_INDEX_PATH, { fallback: { version: 1, names: [] } }),
        spindle.storage.getJson(REGISTRY_PATH, { fallback: { version: 1, macros: [] } }),
    ]);
    const names = Array.isArray(nameIndex?.names) ? nameIndex.names : [];
    for (const rawName of names) {
        const name = String(rawName ?? '').trim();
        if (MACRO_NAME_RE.test(name) && name !== INTERNAL_PICK && name !== INTERNAL_RANDOM)
            persistedMacroNames.add(name);
    }
    legacyRegistry = normalizeStoredRegistry(legacy);
    for (const definition of legacyRegistry)
        persistedMacroNames.add(definition.name);
    if (legacyRegistry.length)
        await persistNameIndex();
    for (const name of persistedMacroNames) {
        try {
            registerUserMacro(name);
        }
        catch (error) {
            spindle.log.warn(`Could not register indexed macro ${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // User-scoped installs can infer their owner at startup. Operator-scoped installs
    // intentionally throw here; their per-user registry is loaded lazily from the
    // userId supplied by frontend messages or macro invocation context.
    try {
        await ensureRegistryLoaded('');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/userId.*required.*operator-scoped/i.test(message)) {
            spindle.log.warn(`Could not preload owner registry: ${message}`);
        }
    }
}
async function initialize() {
    registerInternalMacros();
    await loadRegistryBootstrap();
    spindle.log.info(`Lumi Macro Lab loaded (${registeredUserMacroNames.size} registered macro name${registeredUserMacroNames.size === 1 ? '' : 's'})`);
}
const ready = initialize();
async function globalVariablesList(userId) {
    return spindle.variables.global.list(userId);
}
async function globalVariableSet(userId, key, value) {
    await spindle.variables.global.set(key, value, userId);
}
async function globalVariableDelete(userId, key) {
    await spindle.variables.global.delete(key, userId);
}
async function activeContext(userId) {
    const activeChat = await spindle.chats.getActive(userId);
    const [globalVariables, chatVariables, localVariables] = await Promise.all([
        globalVariablesList(userId),
        activeChat?.id ? spindle.variables.chat.list(activeChat.id) : Promise.resolve({}),
        activeChat?.id ? spindle.variables.local.list(activeChat.id) : Promise.resolve({}),
    ]);
    const chatMap = normalizeVariableMap(chatVariables);
    const decisions = [];
    const visibleChat = {};
    for (const [key, value] of Object.entries(chatMap)) {
        if (key.startsWith(STATE_PREFIX)) {
            const state = parseDecision(value);
            if (state)
                decisions.push({ key, state });
            continue;
        }
        visibleChat[key] = value;
    }
    decisions.sort((a, b) => {
        const macro = a.state.macroName.localeCompare(b.state.macroName);
        if (macro)
            return macro;
        const instance = a.state.instance.localeCompare(b.state.instance);
        if (instance)
            return instance;
        return a.state.decisionId.localeCompare(b.state.decisionId, undefined, { numeric: true });
    });
    return {
        activeChat,
        variables: {
            chat: visibleChat,
            local: normalizeVariableMap(localVariables),
            global: normalizeVariableMap(globalVariables),
        },
        decisions,
    };
}
async function sendState(userId, requestId, notice) {
    await ensureRegistryLoaded(userId);
    const registry = registryForUser(userId);
    const { activeChat, variables, decisions } = await activeContext(userId);
    spindle.sendToFrontend({
        type: 'lumi_macro_lab:state',
        requestId,
        notice: notice ?? '',
        macros: [...registry.values()].sort((a, b) => a.name.localeCompare(b.name)),
        decisions,
        variables,
        context: activeChat
            ? {
                id: activeChat.id,
                name: typeof activeChat.name === 'string' && activeChat.name.trim() ? activeChat.name : 'Active chat',
                hasCharacter: Boolean(activeChat.character_id),
            }
            : null,
    }, userId);
}
async function saveMacro(userId, request) {
    await ensureRegistryLoaded(userId);
    const registry = registryForUser(userId);
    const checked = validateMacroDefinition(request.definition);
    const originalName = String(request.originalName ?? '').trim();
    const priorOriginal = originalName ? registry.get(originalName) : undefined;
    const priorTarget = registry.get(checked.name);
    if (priorTarget && originalName && originalName !== checked.name) {
        throw new Error(`A Macro Lab macro named “${checked.name}” already exists.`);
    }
    // Register the host-level name before mutating storage so a collision with a
    // native/other-extension macro fails cleanly without corrupting the user's registry.
    registerUserMacro(checked.name);
    const timestamp = nowIso();
    const next = {
        ...checked,
        createdAt: priorOriginal?.createdAt ?? priorTarget?.createdAt ?? timestamp,
        updatedAt: timestamp,
    };
    if (originalName && originalName !== checked.name)
        registry.delete(originalName);
    registry.set(checked.name, next);
    try {
        await persistRegistry(userId);
        await addMacroNameToIndex(checked.name);
    }
    catch (error) {
        registry.delete(checked.name);
        if (priorOriginal)
            registry.set(priorOriginal.name, priorOriginal);
        else if (priorTarget)
            registry.set(priorTarget.name, priorTarget);
        throw error;
    }
    return `Registered {{${checked.name}}}. Nested pick/random choices are now sticky per chat instance.`;
}
async function deleteMacro(userId, name) {
    await ensureRegistryLoaded(userId);
    const registry = registryForUser(userId);
    const definition = registry.get(name);
    if (!definition)
        throw new Error(`No Macro Lab macro named “${name}” exists.`);
    registry.delete(name);
    await persistRegistry(userId);
    // Keep the host-level name registered. In an operator install another user may
    // still own a definition with the same name; its handler simply returns empty
    // for users whose isolated registry does not contain that macro.
    const { activeChat } = await activeContext(userId);
    if (activeChat?.id) {
        const chatVariables = normalizeVariableMap(await spindle.variables.chat.list(activeChat.id));
        for (const [key, raw] of Object.entries(chatVariables)) {
            if (!key.startsWith(STATE_PREFIX))
                continue;
            const state = parseDecision(raw);
            if (!state || state.macroName !== name)
                continue;
            liveDecisionCache.delete(cacheKey(activeChat.id, key));
            await spindle.variables.chat.delete(activeChat.id, key);
        }
    }
    return `Deleted {{${name}}} and its state in the active chat.`;
}
async function decisionAction(userId, request) {
    if (!request.key.startsWith(STATE_PREFIX))
        throw new Error('Invalid Macro Lab decision key.');
    const activeChat = await spindle.chats.getActive(userId);
    if (!activeChat?.id)
        throw new Error('Open a chat first; rerollable state is stored per chat.');
    const raw = await spindle.variables.chat.get(activeChat.id, request.key);
    const state = parseDecision(raw);
    if (!state)
        throw new Error('That decision no longer exists.');
    if (request.action === 'toggle_lock') {
        const next = { ...state, locked: !state.locked, updatedAt: nowIso() };
        await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next));
        liveDecisionCache.set(cacheKey(activeChat.id, request.key), next);
        return `${next.locked ? 'Locked' : 'Unlocked'} ${state.macroName}/${state.instance}/${state.decisionId}.`;
    }
    if (state.locked)
        throw new Error('That decision is locked. Unlock it before rerolling or resetting it.');
    if (request.action === 'reset') {
        await spindle.variables.chat.delete(activeChat.id, request.key);
        liveDecisionCache.delete(cacheKey(activeChat.id, request.key));
        return `Reset ${state.macroName}/${state.instance}/${state.decisionId}; it will roll again next time it resolves.`;
    }
    let next;
    if (state.kind === 'pick') {
        const options = state.options ?? [];
        if (!options.length)
            throw new Error('This pick has no saved option snapshot yet. Resolve it once, then reroll.');
        const index = differentRandomIndex(options.length, state.choiceIndex);
        next = {
            ...state,
            choiceIndex: index,
            optionCount: options.length,
            value: options[index] ?? '',
            updatedAt: nowIso(),
        };
    }
    else {
        const randomArgs = state.args ?? [];
        const value = await rerollNativeRandom(randomArgs, state.value, {
            chatId: activeChat.id,
            characterId: activeChat.character_id || undefined,
            userId,
        });
        next = { ...state, value, updatedAt: nowIso() };
    }
    await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next));
    liveDecisionCache.set(cacheKey(activeChat.id, request.key), next);
    return `Rerolled ${state.macroName}/${state.instance}/${state.decisionId}: ${state.value || '∅'} → ${next.value || '∅'}`;
}
async function instanceAction(userId, request) {
    const activeChat = await spindle.chats.getActive(userId);
    if (!activeChat?.id)
        throw new Error('Open a chat first; rerollable state is stored per chat.');
    const chatVariables = normalizeVariableMap(await spindle.variables.chat.list(activeChat.id));
    let changed = 0;
    let locked = 0;
    for (const [key, raw] of Object.entries(chatVariables)) {
        if (!key.startsWith(STATE_PREFIX))
            continue;
        const state = parseDecision(raw);
        if (!state || state.macroName !== request.macroName || state.instance !== request.instance)
            continue;
        if (state.locked) {
            locked += 1;
            continue;
        }
        if (request.action === 'reset') {
            await spindle.variables.chat.delete(activeChat.id, key);
            liveDecisionCache.delete(cacheKey(activeChat.id, key));
            changed += 1;
            continue;
        }
        let next = null;
        if (state.kind === 'pick') {
            const options = state.options ?? [];
            if (options.length) {
                const index = differentRandomIndex(options.length, state.choiceIndex);
                next = { ...state, choiceIndex: index, value: options[index] ?? '', updatedAt: nowIso() };
            }
        }
        else {
            const value = await rerollNativeRandom(state.args ?? [], state.value, {
                chatId: activeChat.id,
                characterId: activeChat.character_id || undefined,
                userId,
            });
            next = { ...state, value, updatedAt: nowIso() };
        }
        if (next) {
            await spindle.variables.chat.set(activeChat.id, key, serializeDecision(next));
            liveDecisionCache.set(cacheKey(activeChat.id, key), next);
            changed += 1;
        }
    }
    const verb = request.action === 'reroll' ? 'Rerolled' : 'Reset';
    const suffix = locked ? ` ${locked} locked decision${locked === 1 ? '' : 's'} were left alone.` : '';
    return `${verb} ${changed} decision${changed === 1 ? '' : 's'} in ${request.macroName}/${request.instance}.${suffix}`;
}
async function variableAction(userId, request) {
    const key = String(request.key ?? '').trim();
    if (!key)
        throw new Error('Variable name is required.');
    if (key.startsWith(STATE_PREFIX))
        throw new Error('Macro Lab decision variables are managed from the Decisions section.');
    const activeChat = request.scope === 'global' ? null : await spindle.chats.getActive(userId);
    if (request.scope !== 'global' && !activeChat?.id)
        throw new Error('Open a chat first to edit chat/local variables.');
    const target = spindle.variables[request.scope];
    if (request.action === 'delete') {
        if (request.scope === 'global')
            await globalVariableDelete(userId, key);
        else
            await target.delete(activeChat.id, key);
        return `Deleted ${request.scope} variable ${key}.`;
    }
    const value = String(request.value ?? '');
    if (request.scope === 'global')
        await globalVariableSet(userId, key, value);
    else
        await target.set(activeChat.id, key, value);
    return `Updated ${request.scope} variable ${key}.`;
}
spindle.onFrontendMessage(async (payload, userId) => {
    if (!isFrontendRequest(payload))
        return;
    const request = payload;
    try {
        await ready;
        await ensureRegistryLoaded(userId);
        if (request.type === 'lumi_macro_lab:resolve') {
            if (request.template.length > MAX_TEMPLATE_LENGTH) {
                throw new Error(`Input is too large (${request.template.length.toLocaleString()} characters). The preview limit is ${MAX_TEMPLATE_LENGTH.toLocaleString()} characters.`);
            }
            const { activeChat, variables } = await activeContext(userId);
            const options = {
                userId,
                commit: false,
            };
            if (activeChat?.id)
                options.chatId = activeChat.id;
            if (activeChat?.character_id)
                options.characterId = activeChat.character_id;
            const result = await spindle.macros.resolve(request.template, options);
            const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
            spindle.sendToFrontend({
                type: 'lumi_macro_lab:result',
                requestId: request.requestId,
                text: typeof result?.text === 'string' ? result.text : '',
                diagnostics,
                context: activeChat
                    ? {
                        name: typeof activeChat.name === 'string' && activeChat.name.trim() ? activeChat.name : 'Active chat',
                        hasCharacter: Boolean(activeChat.character_id),
                        variables,
                    }
                    : null,
            }, userId);
            return;
        }
        if (request.type === 'lumi_macro_lab:get_state') {
            await sendState(userId, request.requestId);
            return;
        }
        if (request.type === 'lumi_macro_lab:save_macro') {
            const notice = await saveMacro(userId, request);
            await sendState(userId, request.requestId, notice);
            return;
        }
        if (request.type === 'lumi_macro_lab:delete_macro') {
            const notice = await deleteMacro(userId, String(request.name ?? '').trim());
            await sendState(userId, request.requestId, notice);
            return;
        }
        if (request.type === 'lumi_macro_lab:decision_action') {
            const notice = await decisionAction(userId, request);
            await sendState(userId, request.requestId, notice);
            return;
        }
        if (request.type === 'lumi_macro_lab:instance_action') {
            const notice = await instanceAction(userId, request);
            await sendState(userId, request.requestId, notice);
            return;
        }
        if (request.type === 'lumi_macro_lab:variable_action') {
            const notice = await variableAction(userId, request);
            await sendState(userId, request.requestId, notice);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        spindle.sendToFrontend({
            type: 'lumi_macro_lab:error',
            requestId: request.requestId,
            error: message,
        }, userId);
    }
});
