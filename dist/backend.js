// ---- bundled from core/decision-graph.js ----
const STOCHASTIC_OPEN_RE = /{{\s*(pick|random)(?=\s*(?:::|}}))/gi;
const GENERIC_OPEN_RE = /{{\s*([A-Za-z][A-Za-z0-9_-]*)(?=\s*(?:::|}}))/g;
function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
function collapseBalancedMacros(input) {
    let text = input;
    for (let pass = 0; pass < 8; pass += 1) {
        const next = text.replace(/{{[^{}]*}}/g, ' ');
        if (next === text)
            break;
        text = next;
    }
    return text;
}
function normalizedContext(input, takeFromEnd) {
    const collapsed = collapseBalancedMacros(input)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[{}]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    if (collapsed.length <= 88)
        return collapsed;
    return takeFromEnd ? collapsed.slice(-88) : collapsed.slice(0, 88);
}
function replaceFriendlyMacros(input) {
    let text = input;
    text = text.replace(/{{\s*char\s*}}/gi, 'character');
    text = text.replace(/{{\s*user\s*}}/gi, 'user');
    for (let pass = 0; pass < 6; pass += 1) {
        const next = text.replace(/{{[^{}]*}}/g, '…');
        if (next === text)
            break;
        text = next;
    }
    return text;
}
function labelFromLeft(body, offset, kind, ordinal) {
    const left = replaceFriendlyMacros(body.slice(Math.max(0, offset - 180), offset))
        .replace(/[\r\n]+/g, '\n');
    const fragments = left.split(/[\n.!?;]+/);
    let label = (fragments.at(-1) ?? '')
        .replace(/^[\s\-–—:;,()[\]{}]+/, '')
        .replace(/[\s\-–—:;,()[\]{}]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (label.length > 64)
        label = label.slice(-64).replace(/^\S+\s*/, '');
    if (label.length < 2)
        label = kind === 'pick' ? `Choice ${ordinal + 1}` : `Random value ${ordinal + 1}`;
    return label;
}
function findMacroEnd(body, start) {
    if (body.slice(start, start + 2) !== '{{')
        return -1;
    let depth = 0;
    for (let index = start; index < body.length - 1; index += 1) {
        const pair = body.slice(index, index + 2);
        if (pair === '{{') {
            depth += 1;
            index += 1;
            continue;
        }
        if (pair === '}}') {
            depth -= 1;
            index += 1;
            if (depth === 0)
                return index + 1;
        }
    }
    return -1;
}
function sourcePreview(label, kind) {
    const token = kind === 'pick' ? '{{pick::…}}' : '{{random::…}}';
    return `${label} ${token}`.trim();
}
function stochasticOccurrences(body) {
    const matches = [];
    STOCHASTIC_OPEN_RE.lastIndex = 0;
    let match;
    let ordinal = 0;
    while ((match = STOCHASTIC_OPEN_RE.exec(body))) {
        const start = match.index;
        const macroEnd = findMacroEnd(body, start);
        matches.push({
            start,
            openEnd: start + match[0].length,
            macroEnd,
            kind: match[1].toLowerCase() === 'pick' ? 'pick' : 'random',
            ordinal,
            match: match[0],
        });
        ordinal += 1;
    }
    return matches;
}
function scanDecisionDescriptors(body) {
    const occurrences = stochasticOccurrences(body);
    const signatureCounts = new Map();
    return occurrences.map((occurrence) => {
        const before = normalizedContext(body.slice(Math.max(0, occurrence.start - 120), occurrence.start), true);
        const rightStart = occurrence.macroEnd >= 0 ? occurrence.macroEnd : occurrence.openEnd;
        const after = normalizedContext(body.slice(rightStart, Math.min(body.length, rightStart + 120)), false);
        const baseSignature = `${occurrence.kind}\u0000${before}\u0000${after}`;
        const rank = signatureCounts.get(baseSignature) ?? 0;
        signatureCounts.set(baseSignature, rank + 1);
        const signature = `${baseSignature}\u0000${rank}`;
        const label = labelFromLeft(body, occurrence.start, occurrence.kind, occurrence.ordinal);
        return {
            id: `d_${fnv1a(signature)}`,
            kind: occurrence.kind,
            ordinal: occurrence.ordinal,
            label,
            sourcePreview: sourcePreview(label, occurrence.kind),
            signature,
        };
    });
}
function encodeMeta(value) {
    return encodeURIComponent(value);
}
function instrumentMacroBody(body, macroName, instance, internalNames) {
    const occurrences = stochasticOccurrences(body);
    const descriptors = scanDecisionDescriptors(body);
    if (!occurrences.length)
        return body;
    let cursor = 0;
    let output = '';
    for (let index = 0; index < occurrences.length; index += 1) {
        const occurrence = occurrences[index];
        const descriptor = descriptors[index];
        const internalName = occurrence.kind === 'pick' ? internalNames.pick : internalNames.random;
        output += body.slice(cursor, occurrence.start);
        output += `{{${internalName}::${encodeMeta(macroName)}::${encodeMeta(instance)}::${encodeMeta(descriptor.id)}::${encodeMeta(descriptor.label)}::${encodeMeta(descriptor.sourcePreview)}`;
        cursor = occurrence.openEnd;
    }
    output += body.slice(cursor);
    return output;
}
function splitTopLevelArgs(inner) {
    const parts = [];
    let depth = 0;
    let cursor = 0;
    for (let index = 0; index < inner.length - 1; index += 1) {
        const pair = inner.slice(index, index + 2);
        if (pair === '{{') {
            depth += 1;
            index += 1;
            continue;
        }
        if (pair === '}}') {
            depth = Math.max(0, depth - 1);
            index += 1;
            continue;
        }
        if (pair === '::' && depth === 0) {
            parts.push(inner.slice(cursor, index));
            cursor = index + 2;
            index += 1;
        }
    }
    parts.push(inner.slice(cursor));
    return parts;
}
function scanMacroReferences(text) {
    const refs = [];
    GENERIC_OPEN_RE.lastIndex = 0;
    let match;
    while ((match = GENERIC_OPEN_RE.exec(text))) {
        const end = findMacroEnd(text, match.index);
        const raw = end >= 0 ? text.slice(match.index, end) : match[0];
        const inner = end >= 0 ? text.slice(match.index + 2, end - 2) : match[0].slice(2);
        const parts = splitTopLevelArgs(inner);
        const name = String(parts.shift() ?? match[1]).trim();
        refs.push({ name, offset: match.index, raw, args: parts });
    }
    return refs;
}
function definitionFingerprint(body) {
    return fnv1a(body.replace(/\r\n/g, '\n'));
}

// ---- bundled from core/state.js ----
const STATE_PREFIX = '__macrolab_v2__';
const LEGACY_STATE_PREFIX = '__lml_state__';
const STATE_VERSION = 2;
function decisionKey(macroName, instance, decisionId) {
    return `${STATE_PREFIX}${fnv1a(`${macroName}\u0000${instance}`)}_${decisionId}`;
}
function serializeDecision(state) {
    return encodeURIComponent(JSON.stringify(state));
}
function stringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : undefined;
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
                // Some test/foreign stores may already contain plain JSON.
            }
        }
        const parsed = JSON.parse(source);
        if (parsed.version !== STATE_VERSION ||
            typeof parsed.macroName !== 'string' ||
            typeof parsed.instance !== 'string' ||
            typeof parsed.decisionId !== 'string' ||
            (parsed.kind !== 'pick' && parsed.kind !== 'random') ||
            typeof parsed.value !== 'string')
            return null;
        const now = new Date().toISOString();
        const history = Array.isArray(parsed.history)
            ? parsed.history
                .filter((entry) => Boolean(entry) && typeof entry === 'object' && typeof entry.value === 'string')
                .map((entry) => ({
                value: String(entry.value),
                at: typeof entry.at === 'string' ? entry.at : now,
                choiceIndex: typeof entry.choiceIndex === 'number' ? entry.choiceIndex : undefined,
            }))
                .slice(-8)
            : undefined;
        return {
            version: STATE_VERSION,
            macroName: parsed.macroName,
            instance: parsed.instance,
            decisionId: parsed.decisionId,
            kind: parsed.kind,
            label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label : parsed.decisionId,
            sourcePreview: typeof parsed.sourcePreview === 'string' ? parsed.sourcePreview : '',
            value: parsed.value,
            locked: Boolean(parsed.locked),
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : (typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now),
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : now,
            revision: typeof parsed.revision === 'number' && Number.isFinite(parsed.revision) ? parsed.revision : 0,
            recipeHash: typeof parsed.recipeHash === 'string' ? parsed.recipeHash : '',
            choiceIndex: typeof parsed.choiceIndex === 'number' ? parsed.choiceIndex : undefined,
            optionCount: typeof parsed.optionCount === 'number' ? parsed.optionCount : undefined,
            options: stringArray(parsed.options),
            args: stringArray(parsed.args),
            history,
        };
    }
    catch {
        return null;
    }
}
function pushHistory(state) {
    const history = Array.isArray(state.history) ? [...state.history] : [];
    history.push({ value: state.value, at: state.updatedAt, choiceIndex: state.choiceIndex });
    return history.slice(-8);
}
function isInternalStateKey(key) {
    return key.startsWith(STATE_PREFIX) || key.startsWith(LEGACY_STATE_PREFIX);
}

// ---- bundled from backend.js ----
const REGISTRY_PATH = 'macro-registry.json';
const REGISTRY_NAME_INDEX_PATH = 'macro-name-index.json';
const OWNER_REGISTRY_KEY = '__owner__';
const INTERNAL_PICK = 'mlDecisionPickV2';
const INTERNAL_RANDOM = 'mlDecisionRandomV2';
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
function nowIso() {
    return new Date().toISOString();
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeVariableMap(value) {
    if (!isRecord(value))
        return {};
    const normalized = {};
    for (const [key, entry] of Object.entries(value))
        normalized[key] = typeof entry === 'string' ? entry : String(entry ?? '');
    return normalized;
}
function isFrontendRequest(payload) {
    return isRecord(payload) && typeof payload.type === 'string' && payload.type.startsWith('macrolab:') && typeof payload.requestId === 'string';
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
function contextIds(ctx) {
    const chatId = String(ctx?.chatId ?? ctx?.env?.chat?.id ?? ctx?.env?.extra?.chatId ?? '');
    const characterId = String(ctx?.characterId ?? ctx?.env?.character?.id ?? ctx?.env?.extra?.characterId ?? '');
    const userId = String(ctx?.userId ?? ctx?.env?.extra?.userId ?? '');
    return { chatId, characterId, userId };
}
function normalizeInstance(args) {
    const values = Array.isArray(args) ? args.map((value) => String(value ?? '')) : [];
    const joined = values.join('::').trim();
    const instance = joined || 'default';
    return instance.length > MAX_INSTANCE_LENGTH ? instance.slice(0, MAX_INSTANCE_LENGTH) : instance;
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
function sameStrings(left, right) {
    return Boolean(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function recipeHash(kind, values) {
    return fnv1a(`${kind}\u0000${values.join('\u0000')}`);
}
function validateMacroDefinition(input) {
    const name = String(input?.name ?? '').trim();
    const description = String(input?.description ?? '').trim();
    const body = String(input?.body ?? '');
    if (!name)
        throw new Error('Macro name is required.');
    if (name.length > MAX_MACRO_NAME_LENGTH)
        throw new Error(`Macro names are limited to ${MAX_MACRO_NAME_LENGTH} characters.`);
    if (!MACRO_NAME_RE.test(name))
        throw new Error('Macro names must start with a letter and contain only letters, numbers, _ or -.');
    if (name === INTERNAL_PICK || name === INTERNAL_RANDOM || /^mlDecision/i.test(name))
        throw new Error('That macro name is reserved by MacroLab.');
    if (name.toLowerCase() === 'pick' || name.toLowerCase() === 'random')
        throw new Error('pick and random are native macros and cannot be replaced by MacroLab.');
    if (!body.trim())
        throw new Error('Macro body cannot be empty.');
    if (body.length > MAX_MACRO_BODY_LENGTH)
        throw new Error(`Macro bodies are limited to ${MAX_MACRO_BODY_LENGTH.toLocaleString()} characters.`);
    if (description.length > MAX_DESCRIPTION_LENGTH)
        throw new Error(`Descriptions are limited to ${MAX_DESCRIPTION_LENGTH} characters.`);
    return { name, description, body };
}
async function readDecision(chatId, key, expected) {
    if (!chatId)
        return null;
    const raw = await spindle.variables.chat.get(chatId, key);
    const state = parseDecision(raw);
    if (!state)
        return null;
    if (state.macroName !== expected.macroName || state.instance !== expected.instance || state.decisionId !== expected.decisionId)
        return null;
    return state;
}
async function persistDecision(ctx, chatId, key, state) {
    if (!chatId || ctx?.commit === false)
        return;
    await spindle.variables.chat.set(chatId, key, serializeDecision(state));
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
        // Fall through to a compact compatibility sampler.
    }
    if (args.length >= 2) {
        const low = Number(args[0]);
        const high = Number(args[1]);
        if (Number.isFinite(low) && Number.isFinite(high)) {
            const min = Math.min(low, high);
            const max = Math.max(low, high);
            if (Number.isInteger(min) && Number.isInteger(max))
                return String(min + Math.floor(Math.random() * (max - min + 1)));
            return String(min + Math.random() * (max - min));
        }
    }
    return String(Math.random());
}
async function rerollNativeRandom(args, previous, context) {
    let value = await sampleNativeRandom(args, context);
    for (let attempt = 0; attempt < 5 && value === previous; attempt += 1)
        value = await sampleNativeRandom(args, context);
    return value;
}
function buildPickState(params) {
    const timestamp = nowIso();
    const { previous } = params;
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
    };
}
function buildRandomState(params) {
    const timestamp = nowIso();
    const { previous } = params;
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
    };
}
function stateNeedsRefresh(previous, next) {
    if (!previous)
        return true;
    if (previous.kind !== next.kind || previous.value !== next.value || previous.label !== next.label || previous.sourcePreview !== next.sourcePreview)
        return true;
    if (previous.recipeHash !== next.recipeHash)
        return true;
    if (next.kind === 'pick' && (!sameStrings(previous.options, next.options ?? []) || previous.choiceIndex !== next.choiceIndex))
        return true;
    if (next.kind === 'random' && !sameStrings(previous.args, next.args ?? []))
        return true;
    return false;
}
function registerInternalMacros() {
    spindle.registerMacro({
        name: INTERNAL_PICK,
        category: 'extension:macro_lab/internal',
        description: 'Internal sticky pick node used by MacroLab.',
        returnType: 'string',
        volatile: true,
        handler: async (ctx) => {
            const args = Array.isArray(ctx?.args) ? ctx.args.map((value) => String(value ?? '')) : [];
            const macroName = decodeMeta(args[0], 'unknown');
            const instance = decodeMeta(args[1], 'default');
            const decisionId = decodeMeta(args[2], 'd_unknown');
            const label = decodeMeta(args[3], decisionId);
            const sourcePreview = decodeMeta(args[4], label);
            const options = args.slice(5);
            if (!options.length)
                return '';
            const { chatId } = contextIds(ctx);
            const key = decisionKey(macroName, instance, decisionId);
            const previous = await readDecision(chatId, key, { macroName, instance, decisionId });
            if (previous?.locked)
                return previous.value;
            let choiceIndex;
            const existingIndex = previous?.kind === 'pick' ? options.indexOf(previous.value) : -1;
            if (existingIndex >= 0)
                choiceIndex = existingIndex;
            else
                choiceIndex = randomIndex(options.length);
            const value = options[choiceIndex] ?? '';
            const next = buildPickState({ previous, macroName, instance, decisionId, label, sourcePreview, options, choiceIndex, value });
            if (stateNeedsRefresh(previous, next))
                await persistDecision(ctx, chatId, key, next);
            return value;
        },
    });
    spindle.registerMacro({
        name: INTERNAL_RANDOM,
        category: 'extension:macro_lab/internal',
        description: 'Internal sticky random node used by MacroLab.',
        returnType: 'string',
        volatile: true,
        handler: async (ctx) => {
            const args = Array.isArray(ctx?.args) ? ctx.args.map((value) => String(value ?? '')) : [];
            const macroName = decodeMeta(args[0], 'unknown');
            const instance = decodeMeta(args[1], 'default');
            const decisionId = decodeMeta(args[2], 'd_unknown');
            const label = decodeMeta(args[3], decisionId);
            const sourcePreview = decodeMeta(args[4], label);
            const randomArgs = args.slice(5);
            const ids = contextIds(ctx);
            const key = decisionKey(macroName, instance, decisionId);
            const previous = await readDecision(ids.chatId, key, { macroName, instance, decisionId });
            if (previous) {
                if (!previous.locked) {
                    const refreshed = buildRandomState({ previous, macroName, instance, decisionId, label, sourcePreview, args: randomArgs, value: previous.value });
                    if (stateNeedsRefresh(previous, refreshed))
                        await persistDecision(ctx, ids.chatId, key, refreshed);
                }
                return previous.value;
            }
            const value = await sampleNativeRandom(randomArgs, ids);
            const next = buildRandomState({ previous: null, macroName, instance, decisionId, label, sourcePreview, args: randomArgs, value });
            await persistDecision(ctx, ids.chatId, key, next);
            return value;
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
        category: 'extension:macro_lab',
        description: `Registered in MacroLab. Use {{${name}}} or {{${name}::instance}}.`,
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
            return instrumentMacroBody(definition.body, name, instance, { pick: INTERNAL_PICK, random: INTERNAL_RANDOM });
        },
    });
    registeredUserMacroNames.add(name);
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
    const payload = {
        version: 1,
        macros: [...registryForUser(userId).values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    await spindle.userStorage.setJson(REGISTRY_PATH, payload, { indent: 2, ...(userId ? { userId } : {}) });
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
    // v1 stored macro definitions are worth preserving. v1 decision state is intentionally
    // not migrated: v2 uses a new namespace and direct host persistence semantics.
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
    for (const rawName of Array.isArray(nameIndex?.names) ? nameIndex.names : []) {
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
    try {
        await ensureRegistryLoaded('');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/userId.*required.*operator-scoped/i.test(message))
            spindle.log.warn(`Could not preload owner registry: ${message}`);
    }
}
async function initialize() {
    registerInternalMacros();
    await loadRegistryBootstrap();
    spindle.log.info(`MacroLab 2 forge loaded (${registeredUserMacroNames.size} registered macro name${registeredUserMacroNames.size === 1 ? '' : 's'})`);
}
const ready = initialize();
async function globalVariablesList(userId) {
    return normalizeVariableMap(await spindle.variables.global.list(userId));
}
async function globalVariableSet(userId, key, value) {
    await spindle.variables.global.set(key, value, userId);
}
async function globalVariableDelete(userId, key) {
    await spindle.variables.global.delete(key, userId);
}
function publicVariables(input) {
    return Object.fromEntries(Object.entries(input).filter(([key]) => !isInternalStateKey(key)));
}
async function activeContext(userId) {
    const activeChat = await spindle.chats.getActive(userId);
    const [chatRaw, localRaw, globalRaw] = await Promise.all([
        activeChat?.id ? spindle.variables.chat.list(activeChat.id) : Promise.resolve({}),
        activeChat?.id ? spindle.variables.local.list(activeChat.id) : Promise.resolve({}),
        globalVariablesList(userId),
    ]);
    const chat = normalizeVariableMap(chatRaw);
    const local = normalizeVariableMap(localRaw);
    const decisions = [];
    for (const [key, raw] of Object.entries(chat)) {
        if (!key.startsWith(STATE_PREFIX))
            continue;
        const state = parseDecision(raw);
        if (state)
            decisions.push({ key, state });
    }
    decisions.sort((a, b) => {
        const left = `${a.state.macroName}\u0000${a.state.instance}\u0000${a.state.label}\u0000${a.state.decisionId}`;
        const right = `${b.state.macroName}\u0000${b.state.instance}\u0000${b.state.label}\u0000${b.state.decisionId}`;
        return left.localeCompare(right);
    });
    return {
        activeChat,
        variables: { chat: publicVariables(chat), local: publicVariables(local), global: publicVariables(globalRaw) },
        decisions,
    };
}
function macroViews(userId) {
    return [...registryForUser(userId).values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((definition) => ({
        ...definition,
        fingerprint: definitionFingerprint(definition.body),
        decisions: scanDecisionDescriptors(definition.body),
    }));
}
async function sendState(userId, requestId, notice = '') {
    const { activeChat, variables, decisions } = await activeContext(userId);
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
    }, userId);
}
async function saveMacro(userId, request) {
    await ensureRegistryLoaded(userId);
    const checked = validateMacroDefinition(request.definition);
    const originalName = String(request.originalName ?? '').trim();
    const registry = registryForUser(userId);
    const priorOriginal = originalName ? registry.get(originalName) : undefined;
    const priorTarget = registry.get(checked.name);
    if (priorTarget && originalName && originalName !== checked.name)
        throw new Error(`A MacroLab macro named “${checked.name}” already exists.`);
    if (priorTarget && !originalName)
        throw new Error(`A MacroLab macro named “${checked.name}” already exists.`);
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
    const decisions = scanDecisionDescriptors(next.body).length;
    return `Saved {{${next.name}}}${decisions ? ` with ${decisions} sticky decision${decisions === 1 ? '' : 's'}` : ''}.`;
}
async function deleteMacro(userId, name) {
    await ensureRegistryLoaded(userId);
    const registry = registryForUser(userId);
    if (!registry.has(name))
        throw new Error(`No MacroLab macro named “${name}” exists.`);
    registry.delete(name);
    await persistRegistry(userId);
    const { activeChat } = await activeContext(userId);
    if (activeChat?.id) {
        const chatVariables = normalizeVariableMap(await spindle.variables.chat.list(activeChat.id));
        for (const [key, raw] of Object.entries(chatVariables)) {
            if (!key.startsWith(STATE_PREFIX))
                continue;
            const state = parseDecision(raw);
            if (state?.macroName === name)
                await spindle.variables.chat.delete(activeChat.id, key);
        }
    }
    return `Deleted {{${name}}} and its v2 state in the active chat.`;
}
async function decisionAction(userId, request) {
    if (!request.key.startsWith(STATE_PREFIX))
        throw new Error('Invalid MacroLab decision key.');
    const activeChat = await spindle.chats.getActive(userId);
    if (!activeChat?.id)
        throw new Error('Open a chat first; Hot Plate state is stored per chat.');
    const raw = await spindle.variables.chat.get(activeChat.id, request.key);
    const state = parseDecision(raw);
    if (!state)
        throw new Error('That decision no longer exists.');
    if (request.action === 'toggle_lock') {
        const next = { ...state, locked: !state.locked, updatedAt: nowIso(), revision: state.revision + 1 };
        await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next));
        return `${next.locked ? 'Locked' : 'Unlocked'} ${state.label}.`;
    }
    if (state.locked)
        throw new Error('That decision is locked. Unlock it first.');
    if (request.action === 'reset') {
        await spindle.variables.chat.delete(activeChat.id, request.key);
        return `Reset ${state.label}; it will roll again on the next committing resolve.`;
    }
    if (request.action === 'undo') {
        const history = [...(state.history ?? [])];
        const previous = history.pop();
        if (!previous)
            throw new Error('No earlier reroll is available for this decision.');
        const next = {
            ...state,
            value: previous.value,
            choiceIndex: previous.choiceIndex,
            history,
            updatedAt: nowIso(),
            revision: state.revision + 1,
        };
        await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next));
        return `Restored ${state.label}: ${next.value || '∅'}.`;
    }
    let next;
    if (state.kind === 'pick') {
        const options = state.options ?? [];
        if (!options.length)
            throw new Error('This choice has no saved option recipe yet. Resolve it once, then reroll.');
        const currentIndex = options.indexOf(state.value);
        const index = differentRandomIndex(options.length, currentIndex >= 0 ? currentIndex : state.choiceIndex);
        next = {
            ...state,
            value: options[index] ?? '',
            choiceIndex: index,
            optionCount: options.length,
            history: pushHistory(state),
            updatedAt: nowIso(),
            revision: state.revision + 1,
        };
    }
    else {
        const value = await rerollNativeRandom(state.args ?? [], state.value, {
            chatId: activeChat.id,
            characterId: activeChat.character_id || undefined,
            userId,
        });
        next = {
            ...state,
            value,
            history: pushHistory(state),
            updatedAt: nowIso(),
            revision: state.revision + 1,
        };
    }
    await spindle.variables.chat.set(activeChat.id, request.key, serializeDecision(next));
    return `Rerolled ${state.label}: ${state.value || '∅'} → ${next.value || '∅'}`;
}
async function instanceAction(userId, request) {
    const activeChat = await spindle.chats.getActive(userId);
    if (!activeChat?.id)
        throw new Error('Open a chat first; Hot Plate state is stored per chat.');
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
            changed += 1;
            continue;
        }
        let next = null;
        if (state.kind === 'pick') {
            const options = state.options ?? [];
            if (options.length) {
                const currentIndex = options.indexOf(state.value);
                const index = differentRandomIndex(options.length, currentIndex >= 0 ? currentIndex : state.choiceIndex);
                next = {
                    ...state,
                    value: options[index] ?? '',
                    choiceIndex: index,
                    optionCount: options.length,
                    history: pushHistory(state),
                    updatedAt: nowIso(),
                    revision: state.revision + 1,
                };
            }
        }
        else {
            const value = await rerollNativeRandom(state.args ?? [], state.value, {
                chatId: activeChat.id,
                characterId: activeChat.character_id || undefined,
                userId,
            });
            next = {
                ...state,
                value,
                history: pushHistory(state),
                updatedAt: nowIso(),
                revision: state.revision + 1,
            };
        }
        if (next) {
            await spindle.variables.chat.set(activeChat.id, key, serializeDecision(next));
            changed += 1;
        }
    }
    const verb = request.action === 'reroll' ? 'Rerolled' : 'Reset';
    const suffix = locked ? ` ${locked} locked decision${locked === 1 ? '' : 's'} stayed put.` : '';
    return `${verb} ${changed} decision${changed === 1 ? '' : 's'} in ${request.macroName} · ${request.instance}.${suffix}`;
}
async function variableAction(userId, request) {
    const key = String(request.key ?? '').trim();
    if (!key)
        throw new Error('Variable name is required.');
    if (isInternalStateKey(key))
        throw new Error('MacroLab decision variables are managed from Hot Plate / State.');
    const activeChat = request.scope === 'global' ? null : await spindle.chats.getActive(userId);
    if (request.scope !== 'global' && !activeChat?.id)
        throw new Error('Open a chat first to edit chat/local variables.');
    if (request.action === 'delete') {
        if (request.scope === 'global')
            await globalVariableDelete(userId, key);
        else
            await spindle.variables[request.scope].delete(activeChat.id, key);
        return `Deleted ${request.scope} variable ${key}.`;
    }
    const value = String(request.value ?? '');
    if (request.scope === 'global')
        await globalVariableSet(userId, key, value);
    else
        await spindle.variables[request.scope].set(activeChat.id, key, value);
    return `Updated ${request.scope} variable ${key}.`;
}
spindle.onFrontendMessage(async (payload, userId) => {
    if (!isFrontendRequest(payload))
        return;
    const request = payload;
    try {
        await ready;
        await ensureRegistryLoaded(userId);
        if (request.type === 'macrolab:resolve') {
            if (request.template.length > MAX_TEMPLATE_LENGTH)
                throw new Error(`Input is too large. Preview is limited to ${MAX_TEMPLATE_LENGTH.toLocaleString()} characters.`);
            const { activeChat, variables } = await activeContext(userId);
            const options = { userId, commit: false };
            if (activeChat?.id)
                options.chatId = activeChat.id;
            if (activeChat?.character_id)
                options.characterId = activeChat.character_id;
            const result = await spindle.macros.resolve(request.template, options);
            const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
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
            }, userId);
            return;
        }
        if (request.type === 'macrolab:get_state') {
            await sendState(userId, request.requestId);
            return;
        }
        if (request.type === 'macrolab:save_macro') {
            await sendState(userId, request.requestId, await saveMacro(userId, request));
            return;
        }
        if (request.type === 'macrolab:delete_macro') {
            await sendState(userId, request.requestId, await deleteMacro(userId, String(request.name ?? '').trim()));
            return;
        }
        if (request.type === 'macrolab:decision_action') {
            await sendState(userId, request.requestId, await decisionAction(userId, request));
            return;
        }
        if (request.type === 'macrolab:instance_action') {
            await sendState(userId, request.requestId, await instanceAction(userId, request));
            return;
        }
        if (request.type === 'macrolab:variable_action') {
            await sendState(userId, request.requestId, await variableAction(userId, request));
            return;
        }
    }
    catch (error) {
        spindle.sendToFrontend({
            type: 'macrolab:error',
            requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error),
        }, userId);
    }
});
