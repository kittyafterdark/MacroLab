function createRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function lineAndColumn(text, offset) {
    const safeOffset = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));
    const before = text.slice(0, safeOffset);
    const lines = before.split('\n');
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
function copyTextFallback(text) {
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    temporary.style.pointerEvents = 'none';
    document.body.appendChild(temporary);
    temporary.select();
    try {
        return document.execCommand('copy');
    }
    finally {
        temporary.remove();
    }
}
function button(label, className = '') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `lml-button ${className}`.trim();
    node.textContent = label;
    return node;
}
function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text)
        node.textContent = text;
    return node;
}
function scopePrefix(scope) {
    if (scope === 'chat')
        return '@';
    if (scope === 'global')
        return '$';
    return '';
}
function friendlyTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;
    return date.toLocaleString();
}
export function setup(ctx) {
    const removeStyle = ctx.dom.addStyle(`
    .lml-shell, .lml-shell * { box-sizing: border-box; }
    .lml-shell {
      display: flex; flex-direction: column; gap: 12px; min-height: 100%; padding: 14px;
      color: var(--lumiverse-text, inherit);
    }
    .lml-tabs {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px;
      background: var(--lumiverse-fill-subtle, rgba(127,127,127,.08));
      border: 1px solid var(--lumiverse-border, rgba(127,127,127,.22));
      border-radius: var(--lumiverse-radius, 12px);
      position: sticky; top: 0; z-index: 4; backdrop-filter: blur(12px);
    }
    .lml-tab-button {
      appearance: none; border: 0; border-radius: calc(var(--lumiverse-radius,12px) - 4px);
      padding: 8px 10px; cursor: pointer; color: inherit; background: transparent;
      font: inherit; font-size: 12px; font-weight: 700;
    }
    .lml-tab-button[aria-selected="true"] {
      background: var(--lumiverse-fill, rgba(127,127,127,.17));
      box-shadow: 0 0 0 1px var(--lumiverse-border, rgba(127,127,127,.2));
    }
    .lml-panel[hidden], .lml-hidden { display: none !important; }
    .lml-panel { display: flex; flex-direction: column; gap: 12px; }
    .lml-intro { margin: 0; color: var(--lumiverse-text-muted, color-mix(in srgb,currentColor 68%,transparent)); font-size: 12px; line-height: 1.55; }
    .lml-card {
      display: flex; flex-direction: column; gap: 9px; padding: 12px;
      background: var(--lumiverse-fill-subtle, rgba(127,127,127,.08));
      border: 1px solid var(--lumiverse-border, rgba(127,127,127,.24));
      border-radius: var(--lumiverse-radius, 12px);
    }
    .lml-card-compact { gap: 7px; padding: 10px; }
    .lml-heading-row, .lml-actions, .lml-status-row, .lml-row-actions, .lml-inline {
      display: flex; align-items: center; gap: 8px;
    }
    .lml-heading-row, .lml-status-row { justify-content: space-between; }
    .lml-actions { flex-wrap: wrap; }
    .lml-row-actions { margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
    .lml-label { margin: 0; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .lml-title { margin: 0; font-size: 13px; font-weight: 750; overflow-wrap: anywhere; }
    .lml-hint, .lml-status, .lml-meta { color: var(--lumiverse-text-muted, color-mix(in srgb,currentColor 68%,transparent)); font-size: 11px; line-height: 1.45; }
    .lml-editor, .lml-output, .lml-input {
      width: 100%; margin: 0; padding: 10px 11px; background: var(--lumiverse-fill, rgba(0,0,0,.16));
      border: 1px solid var(--lumiverse-border, rgba(127,127,127,.3));
      border-radius: calc(var(--lumiverse-radius,12px) - 3px); color: var(--lumiverse-text, inherit);
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    .lml-editor { min-height: 190px; resize: vertical; tab-size: 2; }
    .lml-editor-small { min-height: 135px; }
    .lml-input { min-height: 36px; font-family: inherit; }
    .lml-editor:focus, .lml-input:focus { outline: 2px solid color-mix(in srgb,var(--lumiverse-primary,currentColor) 45%,transparent); outline-offset: 1px; }
    .lml-output { min-height: 190px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; overflow: auto; }
    .lml-output[data-empty="true"] { color: var(--lumiverse-text-muted, color-mix(in srgb,currentColor 55%,transparent)); }
    .lml-button {
      appearance: none; min-height: 32px; padding: 6px 10px; cursor: pointer;
      background: var(--lumiverse-fill, rgba(127,127,127,.12)); border: 1px solid var(--lumiverse-border, rgba(127,127,127,.3));
      border-radius: calc(var(--lumiverse-radius,12px) - 4px); color: var(--lumiverse-text, inherit);
      font: inherit; font-size: 11px; font-weight: 700;
    }
    .lml-button:hover:not(:disabled) { background: color-mix(in srgb,var(--lumiverse-fill,currentColor) 82%,currentColor 8%); }
    .lml-button:focus-visible { outline: 2px solid color-mix(in srgb,var(--lumiverse-primary,currentColor) 45%,transparent); outline-offset: 1px; }
    .lml-button-primary { background: var(--lumiverse-primary,currentColor); border-color: transparent; color: var(--lumiverse-primary-foreground,Canvas); }
    .lml-button-danger { color: var(--lumiverse-danger,#d96a6a); }
    .lml-button:disabled { cursor: not-allowed; opacity: .52; }
    .lml-icon-button { min-width: 32px; padding-inline: 7px; }
    .lml-spacer { flex: 1; }
    .lml-diagnostics { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 10px 10px 10px 28px; background: var(--lumiverse-fill,rgba(0,0,0,.12)); border: 1px solid var(--lumiverse-border,rgba(127,127,127,.26)); border-radius: calc(var(--lumiverse-radius,12px) - 3px); font-size: 12px; line-height: 1.45; }
    .lml-diagnostics[hidden] { display: none; }
    .lml-state-panel { border-top: 1px solid var(--lumiverse-border,rgba(127,127,127,.24)); padding-top: 9px; }
    .lml-state-panel[hidden] { display: none; }
    .lml-state-summary { cursor: pointer; color: var(--lumiverse-text-muted,color-mix(in srgb,currentColor 72%,transparent)); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .lml-state-grid { display: grid; grid-template-columns: minmax(90px,max-content) minmax(0,1fr); gap: 5px 10px; margin-top: 9px; padding: 9px 10px; background: var(--lumiverse-fill,rgba(0,0,0,.12)); border: 1px solid var(--lumiverse-border,rgba(127,127,127,.26)); border-radius: calc(var(--lumiverse-radius,12px) - 3px); font: 11px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; }
    .lml-state-key { font-weight: 700; overflow-wrap: anywhere; }
    .lml-state-value { white-space: pre-wrap; overflow-wrap: anywhere; }
    .lml-status[data-state="error"] { color: var(--lumiverse-danger,#d96a6a); }
    .lml-status[data-state="success"] { color: var(--lumiverse-success,#73b886); }
    .lml-grid { display: grid; gap: 9px; }
    .lml-form-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: 8px; }
    .lml-field { display: flex; flex-direction: column; gap: 5px; }
    .lml-field > label { font-size: 11px; font-weight: 700; }
    .lml-code { font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; }
    .lml-pill { display: inline-flex; align-items: center; width: fit-content; padding: 2px 6px; border: 1px solid var(--lumiverse-border,rgba(127,127,127,.28)); border-radius: 999px; font-size: 10px; font-weight: 700; color: var(--lumiverse-text-muted,currentColor); }
    .lml-macro-row, .lml-decision-row, .lml-variable-row {
      display: flex; align-items: flex-start; gap: 9px; padding: 9px;
      background: var(--lumiverse-fill,rgba(0,0,0,.10)); border: 1px solid var(--lumiverse-border,rgba(127,127,127,.23));
      border-radius: calc(var(--lumiverse-radius,12px) - 4px);
    }
    .lml-decision-row { user-select: none; touch-action: pan-y; }
    .lml-decision-row[data-locked="true"] { opacity: .78; }
    .lml-row-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .lml-row-value { font: 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; overflow-wrap: anywhere; user-select: text; }
    .lml-empty { padding: 12px; text-align: center; border: 1px dashed var(--lumiverse-border,rgba(127,127,127,.3)); border-radius: calc(var(--lumiverse-radius,12px) - 3px); color: var(--lumiverse-text-muted,currentColor); font-size: 11px; line-height: 1.5; }
    .lml-instance { display: flex; flex-direction: column; gap: 7px; padding-top: 5px; }
    .lml-instance + .lml-instance { border-top: 1px solid var(--lumiverse-border,rgba(127,127,127,.2)); padding-top: 11px; }
    .lml-context-menu { position: fixed; z-index: 2147483646; min-width: 165px; padding: 5px; background: var(--lumiverse-fill,Canvas); color: var(--lumiverse-text,CanvasText); border: 1px solid var(--lumiverse-border,rgba(127,127,127,.35)); border-radius: 9px; box-shadow: 0 12px 32px rgba(0,0,0,.28); }
    .lml-context-menu[hidden] { display: none; }
    .lml-context-menu button { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 8px 9px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
    .lml-context-menu button:hover { background: var(--lumiverse-fill-subtle,rgba(127,127,127,.13)); }
    .lml-section-note { margin: 0; font-size: 11px; color: var(--lumiverse-text-muted,currentColor); line-height: 1.5; }
    .lml-count { font-variant-numeric: tabular-nums; }
    @media (max-width: 520px) {
      .lml-shell { padding: 10px; }
      .lml-editor, .lml-output { min-height: 165px; }
      .lml-macro-row, .lml-variable-row { flex-direction: column; }
      .lml-row-actions { margin-left: 0; justify-content: flex-start; }
      .lml-button-primary { flex: 1 1 110px; }
    }
  `);
    const tab = ctx.ui.registerDrawerTab({
        id: 'macro_lab',
        title: 'Macro Lab',
        shortName: 'Macros',
        headerTitle: 'Macro Lab',
        description: 'Resolve macros, register reusable macro bodies, and reroll sticky nested choices',
        keywords: ['macro', 'resolve', 'preview', 'prompt', 'debug', 'reroll', 'random', 'pick', 'variables'],
        iconSvg: `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M7.5 4.5 4 8l3.5 3.5M16.5 4.5 20 8l-3.5 3.5M14.5 3 9.5 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 17.5h14M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `,
    });
    const shell = el('section', 'lml-shell');
    const tabs = el('div', 'lml-tabs');
    const resolutionTabButton = button('Resolution', 'lml-tab-button');
    const macrosTabButton = button('Macros & State', 'lml-tab-button');
    resolutionTabButton.setAttribute('aria-selected', 'true');
    macrosTabButton.setAttribute('aria-selected', 'false');
    tabs.append(resolutionTabButton, macrosTabButton);
    const resolutionPanel = el('section', 'lml-panel');
    const macrosPanel = el('section', 'lml-panel');
    macrosPanel.hidden = true;
    // Resolution panel -------------------------------------------------------
    const resolutionIntro = el('p', 'lml-intro', 'Dry-run the real Lumiverse macro engine. Existing sticky decisions are honored, but preview-only rolls and state mutations are not committed.');
    const inputCard = el('section', 'lml-card');
    const inputHeading = el('div', 'lml-heading-row');
    inputHeading.append(el('h2', 'lml-label', 'Input'), el('span', 'lml-hint', 'Ctrl/⌘ + Enter to resolve'));
    const editor = el('textarea', 'lml-editor');
    editor.spellcheck = false;
    editor.autocomplete = 'off';
    editor.placeholder = 'Try {{backstory}} or any normal Lumi macro…\n\nExample: Hello {{user}}, I am {{char}}.';
    editor.setAttribute('aria-label', 'Macro input');
    const inputActions = el('div', 'lml-actions');
    const resolveButton = button('Resolve', 'lml-button-primary');
    const clearButton = button('Clear');
    const characterCount = el('span', 'lml-hint', '0 characters');
    inputActions.append(resolveButton, clearButton, el('span', 'lml-spacer'), characterCount);
    inputCard.append(inputHeading, editor, inputActions);
    const outputCard = el('section', 'lml-card');
    const outputHeading = el('div', 'lml-heading-row');
    const copyButton = button('Copy');
    copyButton.disabled = true;
    outputHeading.append(el('h2', 'lml-label', 'Resolved output'), copyButton);
    const output = el('pre', 'lml-output', 'Resolved output will appear here.');
    output.dataset.empty = 'true';
    output.setAttribute('aria-live', 'polite');
    const diagnosticsLabel = el('h3', 'lml-label', 'Diagnostics');
    diagnosticsLabel.hidden = true;
    const diagnosticsList = el('ol', 'lml-diagnostics');
    diagnosticsList.hidden = true;
    const previewStatePanel = el('details', 'lml-state-panel');
    previewStatePanel.hidden = true;
    const previewSummary = el('summary', 'lml-state-summary', 'Persisted state before preview');
    const previewGrid = el('div', 'lml-state-grid');
    previewStatePanel.append(previewSummary, el('p', 'lml-section-note', 'This snapshot is loaded before the dry run. Macro Lab internal decision variables are hidden here and shown in Macros & State instead.'), previewGrid);
    const resolveStatus = el('span', 'lml-status', 'Ready. Active chat context is detected when you resolve.');
    resolveStatus.dataset.state = 'idle';
    const resolveStatusRow = el('div', 'lml-status-row');
    resolveStatusRow.append(resolveStatus);
    outputCard.append(outputHeading, output, diagnosticsLabel, diagnosticsList, previewStatePanel, resolveStatusRow);
    resolutionPanel.append(resolutionIntro, inputCard, outputCard);
    // Macros & State panel ---------------------------------------------------
    const stateIntro = el('p', 'lml-intro', 'Register a macro name around ordinary Lumi syntax. Inside that registered body, native {{pick}} and {{random}} nodes become sticky per chat + instance and can be rerolled independently.');
    const stateToolbar = el('div', 'lml-actions');
    const newMacroButton = button('+ Register macro', 'lml-button-primary');
    const refreshButton = button('Refresh');
    const stateContext = el('span', 'lml-hint', 'Loading…');
    stateToolbar.append(newMacroButton, refreshButton, el('span', 'lml-spacer'), stateContext);
    const macroFormCard = el('section', 'lml-card');
    macroFormCard.hidden = true;
    const macroFormHeading = el('div', 'lml-heading-row');
    const macroFormTitle = el('h2', 'lml-label', 'Register macro');
    macroFormHeading.append(macroFormTitle, el('span', 'lml-hint', 'Arguments form the instance key'));
    const macroForm = el('div', 'lml-form-grid');
    const nameField = el('div', 'lml-field');
    const nameLabel = el('label', '', 'Macro name');
    const macroNameInput = el('input', 'lml-input');
    macroNameInput.placeholder = 'backstory';
    macroNameInput.autocomplete = 'off';
    nameField.append(nameLabel, macroNameInput);
    const descField = el('div', 'lml-field');
    const descLabel = el('label', '', 'Description (optional)');
    const macroDescriptionInput = el('input', 'lml-input');
    macroDescriptionInput.placeholder = 'Generates a rerollable character backstory';
    descField.append(descLabel, macroDescriptionInput);
    const bodyField = el('div', 'lml-field');
    const bodyLabel = el('label', '', 'Macro body');
    const macroBodyInput = el('textarea', 'lml-editor lml-editor-small');
    macroBodyInput.spellcheck = false;
    macroBodyInput.placeholder = '{{pick::Born in a ruined city::Raised in the mountains}}…';
    bodyField.append(bodyLabel, macroBodyInput);
    macroForm.append(nameField, descField, bodyField);
    const macroFormActions = el('div', 'lml-actions');
    const saveMacroButton = button('Save macro', 'lml-button-primary');
    const cancelMacroButton = button('Cancel');
    const macroSyntaxHint = el('span', 'lml-hint', 'Use {{name}} for default state or {{name::alice}} for an independent instance.');
    macroFormActions.append(saveMacroButton, cancelMacroButton, el('span', 'lml-spacer'), macroSyntaxHint);
    macroFormCard.append(macroFormHeading, macroForm, macroFormActions);
    const registryCard = el('section', 'lml-card');
    const registryHeading = el('div', 'lml-heading-row');
    const macroCount = el('span', 'lml-hint lml-count', '0 macros');
    registryHeading.append(el('h2', 'lml-label', 'Registered macros'), macroCount);
    const macroList = el('div', 'lml-grid');
    registryCard.append(registryHeading, macroList);
    const decisionsCard = el('section', 'lml-card');
    const decisionsHeading = el('div', 'lml-heading-row');
    const decisionCount = el('span', 'lml-hint lml-count', '0 decisions');
    decisionsHeading.append(el('h2', 'lml-label', 'Sticky decisions — active chat'), decisionCount);
    const decisionList = el('div', 'lml-grid');
    decisionsCard.append(decisionsHeading, el('p', 'lml-section-note', '↻ rerolls only that node. Locked nodes survive bulk rerolls/resets. Right-click or long-press a decision for the same actions.'), decisionList);
    const variablesCard = el('section', 'lml-card');
    const variablesHeading = el('div', 'lml-heading-row');
    variablesHeading.append(el('h2', 'lml-label', 'Native variables'), el('span', 'lml-hint', 'local · @chat · $global'));
    const variablesList = el('div', 'lml-grid');
    variablesCard.append(variablesHeading, el('p', 'lml-section-note', 'These are real Lumi variables, not a shadow store. Edit/delete here and normal macros see the change immediately.'), variablesList);
    const stateStatus = el('span', 'lml-status', 'Loading Macro Lab state…');
    stateStatus.dataset.state = 'working';
    const stateStatusRow = el('div', 'lml-status-row');
    stateStatusRow.append(stateStatus);
    macrosPanel.append(stateIntro, stateToolbar, macroFormCard, registryCard, decisionsCard, variablesCard, stateStatusRow);
    shell.append(tabs, resolutionPanel, macrosPanel);
    tab.root.appendChild(shell);
    // Context menu -----------------------------------------------------------
    const contextMenu = el('div', 'lml-context-menu');
    contextMenu.hidden = true;
    document.body.appendChild(contextMenu);
    let pendingResolveId = null;
    const pendingStateIds = new Set();
    let resolvedText = '';
    let editingOriginalName = '';
    let closeFormOnNextState = false;
    let longPressTimer = null;
    let longPressStart = null;
    const setResolveStatus = (message, state) => {
        resolveStatus.textContent = message;
        resolveStatus.dataset.state = state;
    };
    const setStateStatus = (message, state) => {
        stateStatus.textContent = message;
        stateStatus.dataset.state = state;
    };
    const setResolveBusy = (busy) => {
        resolveButton.disabled = busy;
        clearButton.disabled = busy;
        editor.readOnly = busy;
        resolveButton.textContent = busy ? 'Resolving…' : 'Resolve';
    };
    const sendStateRequest = (payload, statusMessage) => {
        const requestId = createRequestId();
        pendingStateIds.add(requestId);
        if (statusMessage)
            setStateStatus(statusMessage, 'working');
        ctx.sendToBackend({ ...payload, requestId });
        return requestId;
    };
    const refreshState = () => {
        sendStateRequest({ type: 'lumi_macro_lab:get_state' }, 'Refreshing state…');
    };
    const hideContextMenu = () => {
        contextMenu.hidden = true;
        contextMenu.replaceChildren();
    };
    const positionContextMenu = (x, y) => {
        contextMenu.hidden = false;
        const margin = 8;
        const rect = contextMenu.getBoundingClientRect();
        const left = Math.min(Math.max(margin, x), window.innerWidth - rect.width - margin);
        const top = Math.min(Math.max(margin, y), window.innerHeight - rect.height - margin);
        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
    };
    const decisionAction = (key, action) => {
        hideContextMenu();
        sendStateRequest({ type: 'lumi_macro_lab:decision_action', key, action }, `${action === 'reroll' ? 'Rerolling' : action === 'reset' ? 'Resetting' : 'Updating'} decision…`);
    };
    const showDecisionMenu = (x, y, key, state) => {
        contextMenu.replaceChildren();
        const reroll = el('button', '', '↻ Reroll this choice');
        const lock = el('button', '', state.locked ? '🔓 Unlock' : '🔒 Lock');
        const reset = el('button', '', 'Reset decision');
        reroll.disabled = state.locked;
        reset.disabled = state.locked;
        reroll.addEventListener('click', () => decisionAction(key, 'reroll'), { once: true });
        lock.addEventListener('click', () => decisionAction(key, 'toggle_lock'), { once: true });
        reset.addEventListener('click', () => decisionAction(key, 'reset'), { once: true });
        contextMenu.append(reroll, lock, reset);
        positionContextMenu(x, y);
    };
    const attachDecisionGestures = (row, key, state) => {
        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showDecisionMenu(event.clientX, event.clientY, key, state);
        });
        row.addEventListener('pointerdown', (event) => {
            if (event.pointerType === 'mouse')
                return;
            if (longPressTimer)
                clearTimeout(longPressTimer);
            longPressStart = { x: event.clientX, y: event.clientY };
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                if (!longPressStart)
                    return;
                showDecisionMenu(longPressStart.x, longPressStart.y, key, state);
            }, 550);
        });
        const cancelLongPress = (event) => {
            if (event && longPressStart) {
                const distance = Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y);
                if (distance < 8 && event.type === 'pointermove')
                    return;
            }
            if (longPressTimer)
                clearTimeout(longPressTimer);
            longPressTimer = null;
            longPressStart = null;
        };
        row.addEventListener('pointerup', () => cancelLongPress());
        row.addEventListener('pointercancel', () => cancelLongPress());
        row.addEventListener('pointermove', (event) => cancelLongPress(event));
    };
    const renderPreviewVariables = (snapshot) => {
        previewGrid.replaceChildren();
        if (!snapshot) {
            previewStatePanel.hidden = true;
            return;
        }
        const sections = [
            ['chat', snapshot.chat],
            ['local', snapshot.local],
            ['global', snapshot.global],
        ];
        let count = 0;
        for (const [scope, values] of sections) {
            for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
                const keyNode = el('span', 'lml-state-key', `${scopePrefix(scope)}${key}`);
                const valueNode = el('span', 'lml-state-value', value === '' ? '""' : value);
                previewGrid.append(keyNode, valueNode);
                count += 1;
            }
        }
        if (!count)
            previewGrid.append(el('span', 'lml-state-value', 'No native variables found.'));
        previewStatePanel.hidden = false;
    };
    const renderDiagnostics = (template, diagnostics) => {
        diagnosticsList.replaceChildren();
        if (!diagnostics.length) {
            diagnosticsLabel.hidden = true;
            diagnosticsList.hidden = true;
            return;
        }
        diagnosticsLabel.hidden = false;
        diagnosticsList.hidden = false;
        for (const diagnostic of diagnostics) {
            const location = lineAndColumn(template, diagnostic.offset);
            diagnosticsList.append(el('li', '', `Line ${location.line}, column ${location.column}: ${diagnostic.message}`));
        }
    };
    const resetOutput = () => {
        pendingResolveId = null;
        resolvedText = '';
        output.dataset.empty = 'true';
        output.textContent = 'Resolved output will appear here.';
        copyButton.disabled = true;
        diagnosticsLabel.hidden = true;
        diagnosticsList.hidden = true;
        diagnosticsList.replaceChildren();
        previewStatePanel.hidden = true;
        previewStatePanel.open = false;
        previewGrid.replaceChildren();
    };
    const resolve = () => {
        const template = editor.value;
        if (!template.trim()) {
            setResolveStatus('Paste something first, bestie.', 'error');
            editor.focus();
            return;
        }
        const requestId = createRequestId();
        pendingResolveId = requestId;
        setResolveBusy(true);
        setResolveStatus('Resolving with commit:false…', 'working');
        ctx.sendToBackend({ type: 'lumi_macro_lab:resolve', requestId, template });
    };
    const openMacroForm = (definition) => {
        editingOriginalName = definition?.name ?? '';
        macroFormTitle.textContent = definition ? `Edit {{${definition.name}}}` : 'Register macro';
        macroNameInput.value = definition?.name ?? '';
        macroDescriptionInput.value = definition?.description ?? '';
        macroBodyInput.value = definition?.body ?? '';
        macroFormCard.hidden = false;
        macroNameInput.focus();
    };
    const closeMacroForm = () => {
        editingOriginalName = '';
        macroFormCard.hidden = true;
        macroNameInput.value = '';
        macroDescriptionInput.value = '';
        macroBodyInput.value = '';
    };
    const saveMacro = () => {
        const name = macroNameInput.value.trim();
        const body = macroBodyInput.value;
        if (!name || !body.trim()) {
            setStateStatus('Macro name and body are required.', 'error');
            return;
        }
        closeFormOnNextState = true;
        sendStateRequest({
            type: 'lumi_macro_lab:save_macro',
            originalName: editingOriginalName || undefined,
            definition: { name, description: macroDescriptionInput.value, body },
        }, `Registering {{${name}}}…`);
    };
    const deleteMacro = (definition) => {
        if (!window.confirm(`Delete {{${definition.name}}}? Its sticky state in the active chat will also be removed.`))
            return;
        sendStateRequest({ type: 'lumi_macro_lab:delete_macro', name: definition.name }, `Deleting {{${definition.name}}}…`);
    };
    const renderMacros = (macros) => {
        macroList.replaceChildren();
        macroCount.textContent = `${macros.length} macro${macros.length === 1 ? '' : 's'}`;
        if (!macros.length) {
            macroList.append(el('div', 'lml-empty', 'No registered macros yet. Make one and commit some tasteful macro crimes.'));
            return;
        }
        for (const definition of macros) {
            const row = el('div', 'lml-macro-row');
            const main = el('div', 'lml-row-main');
            const title = el('div', 'lml-title lml-code', `{{${definition.name}}}`);
            const description = el('div', 'lml-meta', definition.description || 'No description.');
            const meta = el('div', 'lml-meta', `Updated ${friendlyTimestamp(definition.updatedAt)} · instance: {{${definition.name}::alice}}`);
            main.append(title, description, meta);
            const actions = el('div', 'lml-row-actions');
            const useButton = button('Insert');
            const editButton = button('Edit');
            const deleteButton = button('Delete', 'lml-button-danger');
            useButton.addEventListener('click', () => {
                const syntax = `{{${definition.name}}}`;
                const start = editor.selectionStart ?? editor.value.length;
                const end = editor.selectionEnd ?? start;
                editor.setRangeText(syntax, start, end, 'end');
                characterCount.textContent = `${editor.value.length.toLocaleString()} characters`;
                resolutionTabButton.click();
                editor.focus();
            });
            editButton.addEventListener('click', () => openMacroForm(definition));
            deleteButton.addEventListener('click', () => deleteMacro(definition));
            actions.append(useButton, editButton, deleteButton);
            row.append(main, actions);
            macroList.append(row);
        }
    };
    const renderDecisions = (decisions) => {
        decisionList.replaceChildren();
        decisionCount.textContent = `${decisions.length} decision${decisions.length === 1 ? '' : 's'}`;
        if (!decisions.length) {
            decisionList.append(el('div', 'lml-empty', 'No committed sticky choices in this chat yet. Use a registered macro in an actual generation, then come back and start rerolling reality.'));
            return;
        }
        const groups = new Map();
        for (const item of decisions) {
            const groupKey = `${item.state.macroName}\u0000${item.state.instance}`;
            const bucket = groups.get(groupKey) ?? [];
            bucket.push(item);
            groups.set(groupKey, bucket);
        }
        for (const items of groups.values()) {
            const first = items[0].state;
            const group = el('section', 'lml-instance');
            const heading = el('div', 'lml-heading-row');
            const headingText = el('div', 'lml-inline');
            headingText.append(el('h3', 'lml-title lml-code', `{{${first.macroName}${first.instance === 'default' ? '' : `::${first.instance}`}}}`), el('span', 'lml-pill', `${items.length} node${items.length === 1 ? '' : 's'}`));
            const groupActions = el('div', 'lml-row-actions');
            const rerollAll = button('↻ Reroll all');
            const resetAll = button('Reset all');
            rerollAll.addEventListener('click', () => {
                sendStateRequest({ type: 'lumi_macro_lab:instance_action', macroName: first.macroName, instance: first.instance, action: 'reroll' }, `Rerolling ${first.macroName}/${first.instance}…`);
            });
            resetAll.addEventListener('click', () => {
                sendStateRequest({ type: 'lumi_macro_lab:instance_action', macroName: first.macroName, instance: first.instance, action: 'reset' }, `Resetting ${first.macroName}/${first.instance}…`);
            });
            groupActions.append(rerollAll, resetAll);
            heading.append(headingText, groupActions);
            group.append(heading);
            for (const item of items) {
                const state = item.state;
                const row = el('div', 'lml-decision-row');
                row.dataset.locked = String(state.locked);
                const main = el('div', 'lml-row-main');
                const label = el('div', 'lml-inline');
                label.append(el('span', 'lml-title lml-code', state.decisionId), el('span', 'lml-pill', state.kind), ...(state.locked ? [el('span', 'lml-pill', 'locked')] : []));
                const value = el('div', 'lml-row-value', state.value === '' ? '""' : state.value);
                const details = state.kind === 'pick'
                    ? `${(state.choiceIndex ?? 0) + 1}/${state.optionCount ?? state.options?.length ?? '?'} · ${state.options?.length ?? 0} saved options`
                    : `{{random${state.args?.length ? `::${state.args.join('::')}` : ''}}}`;
                const meta = el('div', 'lml-meta', `${details} · ${friendlyTimestamp(state.updatedAt)}`);
                main.append(label, value, meta);
                const actions = el('div', 'lml-row-actions');
                const reroll = button('↻', 'lml-icon-button');
                reroll.title = 'Reroll this decision';
                const lock = button(state.locked ? '🔓' : '🔒', 'lml-icon-button');
                lock.title = state.locked ? 'Unlock' : 'Lock';
                const reset = button('Reset');
                reroll.disabled = state.locked;
                reset.disabled = state.locked;
                reroll.addEventListener('click', () => decisionAction(item.key, 'reroll'));
                lock.addEventListener('click', () => decisionAction(item.key, 'toggle_lock'));
                reset.addEventListener('click', () => decisionAction(item.key, 'reset'));
                actions.append(reroll, lock, reset);
                row.append(main, actions);
                attachDecisionGestures(row, item.key, state);
                group.append(row);
            }
            decisionList.append(group);
        }
    };
    const variableAction = (scope, action, key, value) => {
        sendStateRequest({ type: 'lumi_macro_lab:variable_action', scope, action, key, value }, `${action === 'set' ? 'Updating' : 'Deleting'} ${scope} variable…`);
    };
    const renderVariables = (snapshot) => {
        variablesList.replaceChildren();
        const scopes = ['local', 'chat', 'global'];
        for (const scope of scopes) {
            const section = el('section', 'lml-instance');
            const heading = el('div', 'lml-heading-row');
            const entries = Object.entries(snapshot[scope]).sort(([a], [b]) => a.localeCompare(b));
            const scopeName = scope === 'chat' ? 'Chat (@)' : scope === 'global' ? 'Global ($)' : 'Local';
            const add = button('+ Add');
            add.addEventListener('click', () => {
                const key = window.prompt(`New ${scope} variable name:`)?.trim();
                if (!key)
                    return;
                const value = window.prompt(`Value for ${scopePrefix(scope)}${key}:`, '');
                if (value === null)
                    return;
                variableAction(scope, 'set', key, value);
            });
            heading.append(el('h3', 'lml-title', scopeName), add);
            section.append(heading);
            if (!entries.length) {
                section.append(el('div', 'lml-empty', `No ${scope} variables.`));
            }
            else {
                for (const [key, value] of entries) {
                    const row = el('div', 'lml-variable-row');
                    const main = el('div', 'lml-row-main');
                    main.append(el('div', 'lml-title lml-code', `${scopePrefix(scope)}${key}`), el('div', 'lml-row-value', value === '' ? '""' : value));
                    const actions = el('div', 'lml-row-actions');
                    const edit = button('Edit');
                    const remove = button('Delete', 'lml-button-danger');
                    edit.addEventListener('click', () => {
                        const next = window.prompt(`Value for ${scopePrefix(scope)}${key}:`, value);
                        if (next === null)
                            return;
                        variableAction(scope, 'set', key, next);
                    });
                    remove.addEventListener('click', () => {
                        if (!window.confirm(`Delete ${scopePrefix(scope)}${key}?`))
                            return;
                        variableAction(scope, 'delete', key);
                    });
                    actions.append(edit, remove);
                    row.append(main, actions);
                    section.append(row);
                }
            }
            variablesList.append(section);
        }
    };
    const renderState = (state) => {
        stateContext.textContent = state.context
            ? `Active: ${state.context.name}${state.context.hasCharacter ? '' : ' · no character'}`
            : 'No active chat';
        renderMacros(Array.isArray(state.macros) ? state.macros : []);
        renderDecisions(Array.isArray(state.decisions) ? state.decisions : []);
        renderVariables(state.variables ?? { local: {}, chat: {}, global: {} });
        if (state.notice)
            setStateStatus(state.notice, 'success');
        else
            setStateStatus('State refreshed. The dice are contained. Mostly.', 'success');
        if (closeFormOnNextState) {
            closeFormOnNextState = false;
            closeMacroForm();
        }
    };
    const switchPanel = (panel) => {
        const resolution = panel === 'resolution';
        resolutionPanel.hidden = !resolution;
        macrosPanel.hidden = resolution;
        resolutionTabButton.setAttribute('aria-selected', String(resolution));
        macrosTabButton.setAttribute('aria-selected', String(!resolution));
        hideContextMenu();
        if (!resolution)
            refreshState();
    };
    // Event wiring -----------------------------------------------------------
    const onResolveClick = () => resolve();
    const onClearClick = () => {
        editor.value = '';
        characterCount.textContent = '0 characters';
        resetOutput();
        setResolveBusy(false);
        setResolveStatus('Cleared. Nothing was saved.', 'idle');
        editor.focus();
    };
    const onEditorInput = () => {
        const count = editor.value.length;
        characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? 'character' : 'characters'}`;
    };
    const onEditorKeydown = (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            resolve();
        }
    };
    const onCopyClick = async () => {
        if (!resolvedText)
            return;
        try {
            if (navigator.clipboard?.writeText)
                await navigator.clipboard.writeText(resolvedText);
            else if (!copyTextFallback(resolvedText))
                throw new Error('Clipboard copy was rejected');
            copyButton.textContent = 'Copied';
            setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
        }
        catch {
            setResolveStatus('Could not copy automatically. Select the output and copy it manually.', 'error');
        }
    };
    const onDocumentPointer = (event) => {
        if (!contextMenu.hidden && !contextMenu.contains(event.target))
            hideContextMenu();
    };
    const onWindowBlur = () => hideContextMenu();
    resolveButton.addEventListener('click', onResolveClick);
    clearButton.addEventListener('click', onClearClick);
    editor.addEventListener('input', onEditorInput);
    editor.addEventListener('keydown', onEditorKeydown);
    copyButton.addEventListener('click', onCopyClick);
    resolutionTabButton.addEventListener('click', () => switchPanel('resolution'));
    macrosTabButton.addEventListener('click', () => switchPanel('macros'));
    newMacroButton.addEventListener('click', () => openMacroForm());
    refreshButton.addEventListener('click', refreshState);
    saveMacroButton.addEventListener('click', saveMacro);
    cancelMacroButton.addEventListener('click', closeMacroForm);
    document.addEventListener('pointerdown', onDocumentPointer);
    window.addEventListener('blur', onWindowBlur);
    const unsubscribeBackend = ctx.onBackendMessage((payload) => {
        if (!payload || typeof payload !== 'object')
            return;
        if (payload.type === 'lumi_macro_lab:result') {
            const result = payload;
            if (result.requestId !== pendingResolveId)
                return;
            pendingResolveId = null;
            setResolveBusy(false);
            resolvedText = result.text;
            output.dataset.empty = 'false';
            output.textContent = result.text;
            copyButton.disabled = result.text.length === 0;
            renderDiagnostics(editor.value, Array.isArray(result.diagnostics) ? result.diagnostics : []);
            renderPreviewVariables(result.context?.variables ?? null);
            const contextMessage = result.context
                ? `Resolved using “${result.context.name}”${result.context.hasCharacter ? '' : ' (no character attached)'}.`
                : 'Resolved without an active chat; only context-free macros were available.';
            const diagnosticMessage = result.diagnostics.length
                ? ` ${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? '' : 's'} found.`
                : ' No diagnostics.';
            setResolveStatus(`${contextMessage}${diagnosticMessage} Dry run: no new sticky decisions were committed.`, 'success');
            return;
        }
        if (payload.type === 'lumi_macro_lab:state') {
            const result = payload;
            if (!pendingStateIds.has(result.requestId))
                return;
            pendingStateIds.delete(result.requestId);
            renderState(result);
            return;
        }
        if (payload.type === 'lumi_macro_lab:error') {
            const failure = payload;
            if (failure.requestId === pendingResolveId) {
                pendingResolveId = null;
                setResolveBusy(false);
                setResolveStatus(`Resolve failed: ${failure.error}`, 'error');
                return;
            }
            if (pendingStateIds.has(failure.requestId)) {
                pendingStateIds.delete(failure.requestId);
                closeFormOnNextState = false;
                setStateStatus(failure.error, 'error');
            }
        }
    });
    refreshState();
    return () => {
        unsubscribeBackend();
        if (longPressTimer)
            clearTimeout(longPressTimer);
        contextMenu.remove();
        document.removeEventListener('pointerdown', onDocumentPointer);
        window.removeEventListener('blur', onWindowBlur);
        tab.destroy();
        removeStyle();
    };
}
