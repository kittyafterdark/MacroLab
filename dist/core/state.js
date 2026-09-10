import { fnv1a } from './decision-graph.js';
export const STATE_PREFIX = '__macrolab_v2__';
export const LEGACY_STATE_PREFIX = '__lml_state__';
export const STATE_VERSION = 2;
export function decisionKey(macroName, instance, decisionId) {
    return `${STATE_PREFIX}${fnv1a(`${macroName}\u0000${instance}`)}_${decisionId}`;
}
export function serializeDecision(state) {
    return encodeURIComponent(JSON.stringify(state));
}
function stringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : undefined;
}
export function parseDecision(value) {
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
export function pushHistory(state) {
    const history = Array.isArray(state.history) ? [...state.history] : [];
    history.push({ value: state.value, at: state.updatedAt, choiceIndex: state.choiceIndex });
    return history.slice(-8);
}
export function isInternalStateKey(key) {
    return key.startsWith(STATE_PREFIX) || key.startsWith(LEGACY_STATE_PREFIX);
}
