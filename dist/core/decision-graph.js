const STOCHASTIC_OPEN_RE = /{{\s*(pick|random)(?=\s*(?:::|}}))/gi;
const GENERIC_OPEN_RE = /{{\s*([A-Za-z][A-Za-z0-9_-]*)(?=\s*(?:::|}}))/g;
export function fnv1a(value) {
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
export function findMacroEnd(body, start) {
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
export function scanDecisionDescriptors(body) {
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
export function instrumentMacroBody(body, macroName, instance, internalNames) {
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
export function scanMacroReferences(text) {
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
export function definitionFingerprint(body) {
    return fnv1a(body.replace(/\r\n/g, '\n'));
}
