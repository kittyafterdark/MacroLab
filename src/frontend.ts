import { scanMacroReferences } from './core/decision-graph.js'
import type { DecisionState } from './core/state.js'
import {
  MACROLAB_BEAKER_ICON,
  MACROLAB_COAT_ICON,
  MACROLAB_HOT_PLATE_ICON,
  MACROLAB_PIPETTE_ICON,
} from './icons.js'
import type {
  BackendError,
  BackendPayload,
  DecisionAction,
  MacroDefinitionView,
  ResolveResult,
  StateResult,
  VariableScope,
} from './shared/protocol.js'

type Cleanup = () => void

type EditableTarget = HTMLTextAreaElement | HTMLInputElement | HTMLElement

type SurfaceSpec = {
  point: string
  label: string
}

const PIPETTE_SURFACES: SurfaceSpec[] = [
  { point: 'world_book_entry_toolbar', label: 'World Book entry' },
  { point: 'preset_editor_toolbar', label: 'Preset editor' },
  { point: 'loom_builder_toolbar', label: 'Loom builder' },
  { point: 'prompt_variables_toolbar', label: 'Prompt variables' },
]

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function button(label: string, className = ''): HTMLButtonElement {
  const node = el('button', `ml-button ${className}`.trim(), label)
  node.type = 'button'
  return node
}

function iconMarkup(icon: string, className = 'ml-icon'): HTMLElement {
  const wrapper = el('span', className)
  wrapper.innerHTML = icon
  wrapper.setAttribute('aria-hidden', 'true')
  return wrapper
}

function iconButton(icon: string, label: string, className = ''): HTMLButtonElement {
  const node = el('button', `ml-icon-button ${className}`.trim())
  node.type = 'button'
  node.title = label
  node.setAttribute('aria-label', label)
  node.append(iconMarkup(icon))
  return node
}

function friendlyTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function scopePrefix(scope: VariableScope): string {
  if (scope === 'chat') return '@'
  if (scope === 'global') return '$'
  return ''
}

function isEditable(node: EventTarget | null): node is EditableTarget {
  if (!(node instanceof HTMLElement)) return false
  if (node instanceof HTMLTextAreaElement) return true
  if (node instanceof HTMLInputElement) {
    const type = node.type.toLowerCase()
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type)
  }
  return node.isContentEditable
}

function editableText(target: EditableTarget): string {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return target.value
  return target.innerText ?? target.textContent ?? ''
}

function targetLabel(target: EditableTarget): string {
  const explicit = target.getAttribute('aria-label') || target.getAttribute('name') || target.getAttribute('placeholder')
  if (explicit?.trim()) return explicit.trim().slice(0, 90)
  if (target instanceof HTMLTextAreaElement) return 'textarea'
  if (target instanceof HTMLInputElement) return 'text field'
  return 'editable field'
}

function insertIntoEditable(target: EditableTarget, text: string): void {
  target.focus()
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length
    const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start
    target.setRangeText(text, start, end, 'end')
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  const selection = window.getSelection()
  if (selection?.rangeCount && target.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const textNode = document.createTextNode(text)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    target.append(document.createTextNode(text))
  }
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
}

function visibleEditableCandidates(): EditableTarget[] {
  return Array.from(document.querySelectorAll<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""]'))
    .filter(isEditable)
    .filter((node) => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    })
}

function copyTextFallback(text: string): boolean {
  const temporary = document.createElement('textarea')
  temporary.value = text
  temporary.setAttribute('readonly', '')
  temporary.style.position = 'fixed'
  temporary.style.opacity = '0'
  temporary.style.pointerEvents = 'none'
  document.body.appendChild(temporary)
  temporary.select()
  try {
    return document.execCommand('copy')
  } finally {
    temporary.remove()
  }
}

export function setup(ctx: any): Cleanup {
  const cleanups: Cleanup[] = []
  let latestState: StateResult | null = null
  let lastEditable: EditableTarget | null = null
  let hotPlateModal: any = null
  let pipetteModal: any = null
  let pipetteRender: (() => void) | null = null
  let hotPlateRender: (() => void) | null = null
  let pendingResolve = ''
  const pendingState = new Set<string>()
  let drawerSection: 'macros' | 'resolution' | 'state' = 'macros'
  let editingMacroName: string | null = null

  const removeStyle = ctx.dom.addStyle(`
    .ml-root, .ml-root * { box-sizing: border-box; }
    .ml-root { color: var(--lumiverse-text, inherit); }
    .ml-shell { display:flex; flex-direction:column; gap:12px; min-height:100%; padding:14px; }
    .ml-hero { display:flex; gap:11px; align-items:center; padding:12px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.24)); border-radius:14px; background:var(--lumiverse-fill-subtle,rgba(127,127,127,.07)); }
    .ml-hero-icon { width:42px; height:42px; flex:0 0 42px; display:grid; place-items:center; }
    .ml-hero-icon svg { width:100%; height:100%; }
    .ml-hero-copy { min-width:0; display:flex; flex-direction:column; gap:3px; }
    .ml-hero-copy strong { font-size:14px; }
    .ml-muted { color:var(--lumiverse-text-muted,color-mix(in srgb,currentColor 66%,transparent)); }
    .ml-small { font-size:11px; line-height:1.45; }
    .ml-tabs { display:grid; grid-template-columns:repeat(3,1fr); gap:5px; padding:4px; position:sticky; top:0; z-index:5; backdrop-filter:blur(12px); background:var(--lumiverse-fill-subtle,rgba(127,127,127,.08)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.22)); border-radius:12px; }
    .ml-tab { appearance:none; border:0; border-radius:8px; padding:8px 9px; background:transparent; color:inherit; font:inherit; font-size:11px; font-weight:750; cursor:pointer; }
    .ml-tab[aria-selected="true"] { background:var(--lumiverse-fill,rgba(127,127,127,.18)); box-shadow:0 0 0 1px var(--lumiverse-border,rgba(127,127,127,.22)); }
    .ml-panel { display:flex; flex-direction:column; gap:11px; }
    .ml-panel[hidden] { display:none!important; }
    .ml-card { display:flex; flex-direction:column; gap:9px; padding:11px; background:var(--lumiverse-fill-subtle,rgba(127,127,127,.07)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.23)); border-radius:12px; }
    .ml-card-flat { background:transparent; }
    .ml-heading, .ml-row, .ml-actions, .ml-inline { display:flex; align-items:center; gap:8px; }
    .ml-heading { justify-content:space-between; }
    .ml-actions { flex-wrap:wrap; }
    .ml-row { align-items:flex-start; }
    .ml-grow { flex:1; min-width:0; }
    .ml-spacer { flex:1; }
    .ml-label { margin:0; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
    .ml-title { margin:0; font-size:12px; font-weight:800; overflow-wrap:anywhere; }
    .ml-code { font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; }
    .ml-pill { display:inline-flex; align-items:center; width:fit-content; padding:2px 6px; border-radius:999px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.28)); font-size:9px; font-weight:800; color:var(--lumiverse-text-muted,currentColor); }
    .ml-button { appearance:none; min-height:31px; padding:6px 9px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.3)); border-radius:8px; background:var(--lumiverse-fill,rgba(127,127,127,.11)); color:inherit; font:inherit; font-size:10px; font-weight:750; cursor:pointer; }
    .ml-button:hover:not(:disabled), .ml-icon-button:hover:not(:disabled) { background:color-mix(in srgb,var(--lumiverse-fill,currentColor) 82%,currentColor 8%); }
    .ml-button:disabled, .ml-icon-button:disabled { opacity:.45; cursor:not-allowed; }
    .ml-button-primary { background:var(--lumiverse-primary,currentColor); border-color:transparent; color:var(--lumiverse-primary-foreground,Canvas); }
    .ml-button-danger { color:var(--lumiverse-danger,#d96a6a); }
    .ml-icon-button { appearance:none; position:relative; display:inline-grid; place-items:center; width:30px; height:30px; min-width:30px; padding:4px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.28)); border-radius:8px; background:var(--lumiverse-fill,rgba(127,127,127,.08)); color:inherit; cursor:pointer; }
    .ml-icon { display:grid; place-items:center; width:100%; height:100%; }
    .ml-icon svg { width:100%; height:100%; display:block; }
    .ml-launcher { width:30px; height:30px; border-radius:8px; }
    .ml-launcher .ml-icon { width:23px; height:23px; }
    .ml-badge { position:absolute; right:-5px; top:-6px; display:grid; place-items:center; min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:var(--lumiverse-primary,currentColor); color:var(--lumiverse-primary-foreground,Canvas); font:800 9px/1 system-ui,sans-serif; box-shadow:0 0 0 2px var(--lumiverse-background,Canvas); }
    .ml-badge[data-zero="true"] { display:none; }
    .ml-input, .ml-editor, .ml-output { width:100%; margin:0; padding:9px 10px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.3)); border-radius:9px; background:var(--lumiverse-fill,rgba(0,0,0,.12)); color:inherit; font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; }
    .ml-input { min-height:35px; font-family:inherit; }
    .ml-editor { min-height:150px; resize:vertical; }
    .ml-editor-large { min-height:210px; }
    .ml-output { min-height:120px; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
    .ml-field { display:flex; flex-direction:column; gap:5px; }
    .ml-field > label { font-size:10px; font-weight:750; }
    .ml-grid { display:grid; gap:8px; }
    .ml-empty { padding:14px; text-align:center; border:1px dashed var(--lumiverse-border,rgba(127,127,127,.3)); border-radius:10px; color:var(--lumiverse-text-muted,currentColor); font-size:11px; line-height:1.5; }
    .ml-macro-card, .ml-decision { display:flex; gap:10px; align-items:flex-start; padding:10px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.2)); border-radius:10px; background:var(--lumiverse-fill,rgba(127,127,127,.045)); }
    .ml-meta { font-size:10px; line-height:1.45; color:var(--lumiverse-text-muted,currentColor); overflow-wrap:anywhere; }
    .ml-value { font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; overflow-wrap:anywhere; }
    .ml-decision[data-locked="true"] { box-shadow:inset 2px 0 0 color-mix(in srgb,currentColor 40%,transparent); }
    .ml-decision-actions { display:flex; gap:5px; margin-left:auto; flex-wrap:wrap; justify-content:flex-end; }
    .ml-instance { display:flex; flex-direction:column; gap:7px; }
    .ml-instance + .ml-instance { border-top:1px solid var(--lumiverse-border,rgba(127,127,127,.2)); padding-top:11px; }
    .ml-surface-header { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
    .ml-surface-icon { width:44px; height:44px; flex:0 0 44px; }
    .ml-surface-icon svg { width:100%; height:100%; display:block; }
    .ml-modal { display:flex; flex-direction:column; gap:11px; padding:2px 0 4px; color:var(--lumiverse-text,inherit); }
    .ml-notice { padding:8px 9px; border-radius:8px; background:var(--lumiverse-fill-subtle,rgba(127,127,127,.08)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.2)); font-size:10px; line-height:1.45; }
    .ml-status[data-kind="error"] { color:var(--lumiverse-danger,#d96a6a); }
    .ml-status[data-kind="success"] { color:var(--lumiverse-success,#73b886); }
    .ml-ref { display:flex; gap:8px; align-items:flex-start; padding:8px; border-radius:8px; background:var(--lumiverse-fill,rgba(127,127,127,.05)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.18)); }
    .ml-ref-count { min-width:24px; text-align:center; }
    .ml-diagnostics { margin:0; padding:9px 9px 9px 25px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.22)); border-radius:9px; font-size:10px; line-height:1.45; }
    .ml-variable-scope { display:flex; flex-direction:column; gap:6px; }
    .ml-variable-row { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-top:1px solid var(--lumiverse-border,rgba(127,127,127,.14)); }
    .ml-variable-row:first-of-type { border-top:0; }
    @media (max-width:560px) {
      .ml-shell { padding:10px; }
      .ml-macro-card, .ml-decision, .ml-row { flex-direction:column; }
      .ml-decision-actions { margin-left:0; justify-content:flex-start; }
      .ml-button-primary { flex:1 1 110px; }
    }
  `)
  cleanups.push(removeStyle)

  const send = (payload: Record<string, unknown>, statusText?: string): string => {
    const id = requestId()
    if (payload.type !== 'macrolab:resolve') pendingState.add(id)
    ctx.sendToBackend({ ...payload, requestId: id })
    if (statusText) setDrawerStatus(statusText, 'idle')
    return id
  }

  const refreshState = (quiet = true) => send({ type: 'macrolab:get_state' }, quiet ? undefined : 'Refreshing…')

  // Keep the last meaningful text control even after clicking a toolbar button.
  const onFocusIn = (event: FocusEvent) => {
    if (isEditable(event.target)) lastEditable = event.target
  }
  document.addEventListener('focusin', onFocusIn, true)
  cleanups.push(() => document.removeEventListener('focusin', onFocusIn, true))

  const resolveEditable = (): EditableTarget | null => {
    if (lastEditable?.isConnected) return lastEditable
    const candidates = visibleEditableCandidates()
    return candidates.length === 1 ? candidates[0] : null
  }

  // Drawer: MacroLab ------------------------------------------------------
  const tab = ctx.ui.registerDrawerTab({
    id: 'macro_lab',
    title: 'MacroLab',
    shortName: 'Macros',
    headerTitle: 'MacroLab',
    description: 'Author registered macros, preview resolution, and inspect raw state.',
    keywords: ['macro', 'pick', 'random', 'reroll', 'hot plate', 'pipette', 'variables', 'resolution'],
    iconSvg: MACROLAB_BEAKER_ICON,
  })
  cleanups.push(() => tab.destroy())

  const shell = el('section', 'ml-root ml-shell')
  const hero = el('section', 'ml-hero')
  const heroIcon = iconMarkup(MACROLAB_COAT_ICON, 'ml-hero-icon')
  const heroCopy = el('div', 'ml-hero-copy')
  heroCopy.append(el('strong', '', 'MacroLab'), el('span', 'ml-muted ml-small', 'Build the recipe here. Pipette inspects editors; Hot Plate holds live chat state.'))
  hero.append(heroIcon, heroCopy)

  const nav = el('div', 'ml-tabs')
  const navButtons = {
    macros: button('Macros', 'ml-tab'),
    resolution: button('Resolution', 'ml-tab'),
    state: button('State', 'ml-tab'),
  }
  for (const [key, node] of Object.entries(navButtons)) {
    node.setAttribute('aria-selected', String(key === 'macros'))
    nav.append(node)
  }

  const macrosPanel = el('section', 'ml-panel')
  const resolutionPanel = el('section', 'ml-panel')
  const statePanel = el('section', 'ml-panel')
  resolutionPanel.hidden = true
  statePanel.hidden = true

  const status = el('div', 'ml-status ml-small ml-muted', 'Loading MacroLab…')
  status.setAttribute('aria-live', 'polite')
  const setDrawerStatus = (text: string, kind: 'idle' | 'success' | 'error') => {
    status.textContent = text
    status.dataset.kind = kind
  }

  const switchDrawer = (section: 'macros' | 'resolution' | 'state') => {
    drawerSection = section
    macrosPanel.hidden = section !== 'macros'
    resolutionPanel.hidden = section !== 'resolution'
    statePanel.hidden = section !== 'state'
    for (const [key, node] of Object.entries(navButtons)) node.setAttribute('aria-selected', String(key === section))
    if (section !== 'resolution') refreshState()
  }
  navButtons.macros.addEventListener('click', () => switchDrawer('macros'))
  navButtons.resolution.addEventListener('click', () => switchDrawer('resolution'))
  navButtons.state.addEventListener('click', () => switchDrawer('state'))

  // Macro authoring
  const macrosToolbar = el('div', 'ml-heading')
  macrosToolbar.append(el('div', 'ml-grow', ''), button('+ New macro', 'ml-button-primary'))
  const newMacroButton = macrosToolbar.querySelector('button') as HTMLButtonElement
  const macroForm = el('section', 'ml-card')
  macroForm.hidden = true
  const macroName = el('input', 'ml-input')
  macroName.placeholder = 'backstory'
  const macroDescription = el('input', 'ml-input')
  macroDescription.placeholder = 'Optional description'
  const macroBody = el('textarea', 'ml-editor ml-editor-large')
  macroBody.spellcheck = false
  macroBody.placeholder = 'Born in {{pick::a coastal city::a mountain village}}…'
  const macroFormActions = el('div', 'ml-actions')
  const saveMacro = button('Save macro', 'ml-button-primary')
  const cancelMacro = button('Cancel')
  macroFormActions.append(saveMacro, cancelMacro)
  const macroPreview = el('div', 'ml-small ml-muted')
  macroForm.replaceChildren(
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Macro name'), macroName); return f })(),
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Description'), macroDescription); return f })(),
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Macro body'), macroBody); return f })(),
    macroPreview,
    macroFormActions,
  )
  const macroList = el('div', 'ml-grid')
  const macrosCard = el('section', 'ml-card')
  const macroHeading = el('div', 'ml-heading')
  macroHeading.append(el('h2', 'ml-label', 'Registered macros'), el('span', 'ml-small ml-muted', 'Reusable · sticky nested pick/random'))
  macrosCard.append(macroHeading, macroList)
  macrosPanel.append(macrosToolbar, macroForm, macrosCard)

  const openMacroForm = (definition?: MacroDefinitionView) => {
    editingMacroName = definition?.name ?? null
    macroName.value = definition?.name ?? ''
    macroDescription.value = definition?.description ?? ''
    macroBody.value = definition?.body ?? ''
    macroForm.hidden = false
    updateMacroPreview()
    macroName.focus()
  }
  const closeMacroForm = () => {
    editingMacroName = null
    macroForm.hidden = true
    macroName.value = ''
    macroDescription.value = ''
    macroBody.value = ''
  }
  const updateMacroPreview = () => {
    const refs = scanMacroReferences(macroBody.value)
    const stochastic = refs.filter((ref) => ref.name.toLowerCase() === 'pick' || ref.name.toLowerCase() === 'random').length
    macroPreview.textContent = `${macroBody.value.length.toLocaleString()} characters · ${stochastic} inline stochastic reference${stochastic === 1 ? '' : 's'}`
  }
  macroBody.addEventListener('input', updateMacroPreview)
  newMacroButton.addEventListener('click', () => openMacroForm())
  cancelMacro.addEventListener('click', closeMacroForm)
  saveMacro.addEventListener('click', () => {
    const name = macroName.value.trim()
    if (!name || !macroBody.value.trim()) {
      setDrawerStatus('Macro name and body are required.', 'error')
      return
    }
    send({
      type: 'macrolab:save_macro',
      originalName: editingMacroName ?? undefined,
      definition: { name, description: macroDescription.value, body: macroBody.value },
    }, 'Saving macro…')
  })

  // Resolution
  const resolutionIntro = el('div', 'ml-notice', 'Preview mode uses the real macro resolver with commit:false. Existing Hot Plate state is honored; missing choices are sampled ephemerally and never become canon.')
  const resolutionInputCard = el('section', 'ml-card')
  const resolutionEditor = el('textarea', 'ml-editor ml-editor-large')
  resolutionEditor.spellcheck = false
  resolutionEditor.placeholder = '{{backstory::alice}}\n\nHello {{user}}, I am {{char}}.'
  const resolveActions = el('div', 'ml-actions')
  const resolveButton = button('Preview resolution', 'ml-button-primary')
  const clearResolution = button('Clear')
  resolveActions.append(resolveButton, clearResolution)
  resolutionInputCard.append(el('h2', 'ml-label', 'Input'), resolutionEditor, resolveActions)
  const resolutionOutputCard = el('section', 'ml-card')
  const outputHeading = el('div', 'ml-heading')
  const copyOutput = button('Copy')
  copyOutput.disabled = true
  outputHeading.append(el('h2', 'ml-label', 'Resolved output'), copyOutput)
  const resolutionOutput = el('pre', 'ml-output', 'Resolved output appears here.')
  const diagnostics = el('ol', 'ml-diagnostics')
  diagnostics.hidden = true
  resolutionOutputCard.append(outputHeading, resolutionOutput, diagnostics)
  resolutionPanel.append(resolutionIntro, resolutionInputCard, resolutionOutputCard)

  const doResolve = () => {
    if (!resolutionEditor.value.trim()) {
      setDrawerStatus('Give Resolution something to chew on first.', 'error')
      return
    }
    pendingResolve = requestId()
    resolveButton.disabled = true
    setDrawerStatus('Previewing without commit…', 'idle')
    ctx.sendToBackend({ type: 'macrolab:resolve', requestId: pendingResolve, template: resolutionEditor.value })
  }
  resolveButton.addEventListener('click', doResolve)
  resolutionEditor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      doResolve()
    }
  })
  clearResolution.addEventListener('click', () => {
    resolutionEditor.value = ''
    resolutionOutput.textContent = 'Resolved output appears here.'
    diagnostics.hidden = true
    copyOutput.disabled = true
  })
  copyOutput.addEventListener('click', async () => {
    const text = resolutionOutput.textContent ?? ''
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else if (!copyTextFallback(text)) throw new Error('copy failed')
      setDrawerStatus('Copied resolved output.', 'success')
    } catch {
      setDrawerStatus('Clipboard copy failed; select the output manually.', 'error')
    }
  })

  // Raw State page
  const stateContext = el('div', 'ml-notice', 'No active chat loaded yet.')
  const rawDecisionList = el('div', 'ml-grid')
  const variableList = el('div', 'ml-grid')
  const stateRefresh = button('Refresh')
  stateRefresh.addEventListener('click', () => refreshState(false))
  const stateTop = el('div', 'ml-heading')
  stateTop.append(el('h2', 'ml-label', 'Active chat state'), stateRefresh)
  const rawStateCard = el('section', 'ml-card')
  rawStateCard.append(stateTop, stateContext, rawDecisionList)
  const varsCard = el('section', 'ml-card')
  varsCard.append(el('h2', 'ml-label', 'Native variables'), el('div', 'ml-small ml-muted', 'Advanced view. MacroLab v2 decision variables are intentionally hidden from this list.'), variableList)
  statePanel.append(rawStateCard, varsCard)

  shell.append(hero, nav, macrosPanel, resolutionPanel, statePanel, status)
  tab.root.append(shell)

  // Shared state actions ---------------------------------------------------
  const decisionAction = (key: string, action: DecisionAction, busy = 'Updating decision…') => {
    send({ type: 'macrolab:decision_action', key, action }, busy)
  }
  const instanceAction = (macroNameValue: string, instance: string, action: 'reroll' | 'reset') => {
    send({ type: 'macrolab:instance_action', macroName: macroNameValue, instance, action }, action === 'reroll' ? 'Rerolling unlocked choices…' : 'Resetting unlocked choices…')
  }

  const groupedDecisions = (state: StateResult | null) => {
    const groups = new Map<string, Array<{ key: string; state: DecisionState }>>()
    for (const item of state?.decisions ?? []) {
      const key = `${item.state.macroName}\u0000${item.state.instance}`
      const group = groups.get(key) ?? []
      group.push(item)
      groups.set(key, group)
    }
    return groups
  }

  const renderDecisionGroups = (container: HTMLElement, state: StateResult | null, compact: boolean) => {
    container.replaceChildren()
    if (!state?.context) {
      container.append(el('div', 'ml-empty', 'Open a chat to see committed MacroLab state.'))
      return
    }
    if (!state.decisions.length) {
      container.append(el('div', 'ml-empty', 'Nothing committed yet. Generate with a registered MacroLab macro and the choices will appear here.'))
      return
    }

    for (const [, items] of groupedDecisions(state)) {
      const first = items[0].state
      const group = el('section', 'ml-instance')
      const heading = el('div', 'ml-heading')
      const left = el('div', 'ml-grow')
      left.append(el('div', 'ml-title ml-code', `${first.macroName} · ${first.instance}`), el('div', 'ml-meta', `${items.length} decision${items.length === 1 ? '' : 's'} · ${items.filter((item) => item.state.locked).length} locked`))
      const groupActions = el('div', 'ml-actions')
      const rerollAll = button('↻ Unlocked')
      const resetAll = button('Reset')
      rerollAll.addEventListener('click', () => instanceAction(first.macroName, first.instance, 'reroll'))
      resetAll.addEventListener('click', () => instanceAction(first.macroName, first.instance, 'reset'))
      groupActions.append(rerollAll, resetAll)
      heading.append(left, groupActions)
      group.append(heading)

      for (const item of items) {
        const decision = item.state
        const row = el('div', 'ml-decision')
        row.dataset.locked = String(decision.locked)
        const main = el('div', 'ml-grow')
        const labelLine = el('div', 'ml-inline')
        labelLine.append(el('strong', 'ml-title', decision.label), el('span', 'ml-pill', decision.kind))
        if (decision.locked) labelLine.append(el('span', 'ml-pill', 'locked'))
        const value = el('div', 'ml-value', decision.value === '' ? '""' : decision.value)
        const detailParts = compact
          ? [decision.sourcePreview]
          : [decision.decisionId, decision.sourcePreview, `rev ${decision.revision}`, friendlyTimestamp(decision.updatedAt)]
        const meta = el('div', 'ml-meta', detailParts.filter(Boolean).join(' · '))
        main.append(labelLine, value, meta)

        const actions = el('div', 'ml-decision-actions')
        const reroll = button('↻')
        const undo = button('Undo')
        const lock = button(decision.locked ? 'Unlock' : 'Lock')
        const reset = button('Reset')
        reroll.disabled = decision.locked
        reset.disabled = decision.locked
        undo.disabled = decision.locked || !(decision.history?.length)
        reroll.addEventListener('click', () => decisionAction(item.key, 'reroll', `Rerolling ${decision.label}…`))
        undo.addEventListener('click', () => decisionAction(item.key, 'undo', `Restoring ${decision.label}…`))
        lock.addEventListener('click', () => decisionAction(item.key, 'toggle_lock', `${decision.locked ? 'Unlocking' : 'Locking'} ${decision.label}…`))
        reset.addEventListener('click', () => decisionAction(item.key, 'reset', `Resetting ${decision.label}…`))
        actions.append(reroll, undo, lock, reset)
        row.append(main, actions)
        group.append(row)
      }
      container.append(group)
    }
  }

  const renderMacros = (state: StateResult | null) => {
    macroList.replaceChildren()
    const macros = state?.macros ?? []
    if (!macros.length) {
      macroList.append(el('div', 'ml-empty', 'No registered macros yet. Make one here, then use it from cards, lorebooks, presets, or anywhere Lumi resolves macros.'))
      return
    }
    for (const definition of macros) {
      const card = el('div', 'ml-macro-card')
      const main = el('div', 'ml-grow')
      const title = el('div', 'ml-inline')
      title.append(el('strong', 'ml-title ml-code', `{{${definition.name}}}`), el('span', 'ml-pill', `${definition.decisions.length} sticky`))
      const desc = el('div', 'ml-meta', definition.description || 'No description')
      const meta = el('div', 'ml-meta', `${definition.body.length.toLocaleString()} chars · ${definition.fingerprint} · updated ${friendlyTimestamp(definition.updatedAt)}`)
      main.append(title, desc, meta)
      const actions = el('div', 'ml-decision-actions')
      const insert = button('Insert')
      const edit = button('Edit')
      const remove = button('Delete', 'ml-button-danger')
      insert.addEventListener('click', () => {
        const target = resolveEditable()
        if (!target) {
          setDrawerStatus('Focus a text field first, then Insert can place the macro there.', 'error')
          return
        }
        insertIntoEditable(target, `{{${definition.name}}}`)
        setDrawerStatus(`Inserted {{${definition.name}}}.`, 'success')
      })
      edit.addEventListener('click', () => openMacroForm(definition))
      remove.addEventListener('click', async () => {
        const result = await ctx.ui.showConfirm({
          title: `Delete {{${definition.name}}}?`,
          message: 'The definition and its v2 state in the active chat will be removed. The host-level macro name remains reserved for operator-user isolation.',
          variant: 'danger',
          confirmLabel: 'Delete macro',
        })
        if (result?.confirmed) send({ type: 'macrolab:delete_macro', name: definition.name }, 'Deleting macro…')
      })
      actions.append(insert, edit, remove)
      card.append(main, actions)
      macroList.append(card)
    }
  }

  const variableAction = (scope: VariableScope, action: 'set' | 'delete', key: string, value?: string) => {
    send({ type: 'macrolab:variable_action', scope, action, key, value }, `${action === 'set' ? 'Updating' : 'Deleting'} ${scope} variable…`)
  }

  const renderVariables = (state: StateResult | null) => {
    variableList.replaceChildren()
    const snapshot = state?.variables ?? { local: {}, chat: {}, global: {} }
    for (const scope of ['local', 'chat', 'global'] as VariableScope[]) {
      const section = el('section', 'ml-variable-scope')
      const heading = el('div', 'ml-heading')
      const add = button('+ Add')
      const scopeName = scope === 'chat' ? 'Chat (@)' : scope === 'global' ? 'Global ($)' : 'Local'
      heading.append(el('strong', 'ml-title', scopeName), add)
      add.addEventListener('click', () => {
        const key = window.prompt(`New ${scope} variable name:`)?.trim()
        if (!key) return
        const value = window.prompt(`Value for ${scopePrefix(scope)}${key}:`, '')
        if (value === null) return
        variableAction(scope, 'set', key, value)
      })
      section.append(heading)
      const entries = Object.entries(snapshot[scope]).sort(([a], [b]) => a.localeCompare(b))
      if (!entries.length) section.append(el('div', 'ml-meta', `No ${scope} variables.`))
      for (const [key, value] of entries) {
        const row = el('div', 'ml-variable-row')
        const main = el('div', 'ml-grow')
        main.append(el('div', 'ml-title ml-code', `${scopePrefix(scope)}${key}`), el('div', 'ml-value', value === '' ? '""' : value))
        const actions = el('div', 'ml-actions')
        const edit = button('Edit')
        const remove = button('Delete', 'ml-button-danger')
        edit.addEventListener('click', () => {
          const next = window.prompt(`Value for ${scopePrefix(scope)}${key}:`, value)
          if (next !== null) variableAction(scope, 'set', key, next)
        })
        remove.addEventListener('click', () => variableAction(scope, 'delete', key))
        actions.append(edit, remove)
        row.append(main, actions)
        section.append(row)
      }
      variableList.append(section)
    }
  }

  const renderRawState = (state: StateResult | null) => {
    stateContext.textContent = state?.context
      ? `${state.context.name} · ${state.decisions.length} committed decision${state.decisions.length === 1 ? '' : 's'}`
      : 'No active chat.'
    renderDecisionGroups(rawDecisionList, state, false)
    renderVariables(state)
  }

  // Hot Plate -------------------------------------------------------------
  const renderHotPlate = () => {
    if (!hotPlateModal) return
    const root = hotPlateModal.root as HTMLElement
    root.replaceChildren()
    const body = el('section', 'ml-root ml-modal')
    const header = el('div', 'ml-surface-header')
    header.append(iconMarkup(MACROLAB_HOT_PLATE_ICON, 'ml-surface-icon'))
    const copy = el('div', 'ml-grow')
    copy.append(el('strong', 'ml-title', 'Hot Plate'), el('div', 'ml-meta', latestState?.context ? `${latestState.context.name} · live committed state` : 'No active chat'))
    header.append(copy)
    const toolbar = el('div', 'ml-actions')
    const refresh = button('Refresh')
    const openLab = button('Open MacroLab')
    refresh.addEventListener('click', () => refreshState(false))
    openLab.addEventListener('click', () => {
      hotPlateModal?.dismiss()
      tab.activate()
      switchDrawer('state')
    })
    toolbar.append(refresh, openLab)
    const list = el('div', 'ml-grid')
    renderDecisionGroups(list, latestState, true)
    body.append(header, toolbar, list)
    root.append(body)
  }
  hotPlateRender = renderHotPlate

  const openHotPlate = () => {
    if (hotPlateModal) return
    pipetteModal?.dismiss?.()
    hotPlateModal = ctx.ui.showModal({ title: 'Hot Plate', width: 650, maxHeight: 760 })
    hotPlateModal.onDismiss(() => {
      hotPlateModal = null
      hotPlateRender = null
    })
    hotPlateRender = renderHotPlate
    renderHotPlate()
    refreshState()
  }

  const launcherNodes: Array<{ button: HTMLButtonElement; badge?: HTMLElement }> = []
  const mountLauncher = (point: string, label: string, onClick: () => void, withBadge = false) => {
    try {
      const host = ctx.ui.mount(point)
      const node = iconButton(MACROLAB_BEAKER_ICON, label, 'ml-launcher')
      let badge: HTMLElement | undefined
      if (withBadge) {
        badge = el('span', 'ml-badge', '0')
        badge.dataset.zero = 'true'
        node.append(badge)
      }
      node.addEventListener('click', onClick)
      host.append(node)
      launcherNodes.push({ button: node, badge })
      cleanups.push(() => node.remove())
    } catch (error) {
      console.warn(`[MacroLab] Could not mount ${point}:`, error)
    }
  }

  mountLauncher('chat_input_tools_right', 'Open MacroLab Hot Plate', openHotPlate, true)

  // Pipette ---------------------------------------------------------------
  const renderPipette = (surfaceLabel: string) => {
    if (!pipetteModal) return
    const root = pipetteModal.root as HTMLElement
    root.replaceChildren()
    const body = el('section', 'ml-root ml-modal')
    const header = el('div', 'ml-surface-header')
    header.append(iconMarkup(MACROLAB_PIPETTE_ICON, 'ml-surface-icon'))
    const headerCopy = el('div', 'ml-grow')
    headerCopy.append(el('strong', 'ml-title', 'Pipette'), el('div', 'ml-meta', `Contextual macro inspection · ${surfaceLabel}`))
    header.append(headerCopy)

    const target = resolveEditable()
    if (!target) {
      body.append(header, el('div', 'ml-empty', 'Focus the text field you want to inspect, then open Pipette again. If several editors are visible, MacroLab refuses to guess which one you meant.'))
      root.append(body)
      return
    }

    const text = editableText(target)
    const refs = scanMacroReferences(text)
    const macroMap = new Map((latestState?.macros ?? []).map((macro) => [macro.name.toLowerCase(), macro]))
    const counts = new Map<string, { name: string; count: number; definition?: MacroDefinitionView; kind: 'registered' | 'stochastic' | 'native' }>()
    for (const ref of refs) {
      const lower = ref.name.toLowerCase()
      const definition = macroMap.get(lower)
      const kind = definition ? 'registered' : (lower === 'pick' || lower === 'random' ? 'stochastic' : 'native')
      const existing = counts.get(lower)
      if (existing) existing.count += 1
      else counts.set(lower, { name: ref.name, count: 1, definition, kind })
    }

    const targetCard = el('section', 'ml-card')
    targetCard.append(
      el('h2', 'ml-label', 'Current field'),
      el('div', 'ml-title', targetLabel(target)),
      el('div', 'ml-meta', `${text.length.toLocaleString()} characters · ${refs.length} macro reference${refs.length === 1 ? '' : 's'}`),
    )

    const foundCard = el('section', 'ml-card')
    foundCard.append(el('h2', 'ml-label', 'Detected here'))
    if (!counts.size) foundCard.append(el('div', 'ml-empty', 'No macro references in this field yet. Use the registered list below to insert one.'))
    for (const item of [...counts.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = el('div', 'ml-ref')
      const count = el('span', 'ml-pill ml-ref-count', String(item.count))
      const main = el('div', 'ml-grow')
      const title = el('div', 'ml-inline')
      title.append(el('strong', 'ml-title ml-code', `{{${item.name}}}`), el('span', 'ml-pill', item.kind))
      if (item.definition) title.append(el('span', 'ml-pill', `${item.definition.decisions.length} sticky`))
      const meta = item.definition
        ? (item.definition.description || `${item.definition.body.length.toLocaleString()} character registered macro`)
        : item.kind === 'stochastic' ? 'Inline stochastic macro' : 'Native or external macro reference'
      main.append(title, el('div', 'ml-meta', meta))
      const actions = el('div', 'ml-actions')
      if (item.definition) {
        const edit = button('Open in Lab')
        edit.addEventListener('click', () => {
          pipetteModal?.dismiss()
          tab.activate()
          switchDrawer('macros')
          openMacroForm(item.definition)
        })
        actions.append(edit)
      }
      row.append(count, main, actions)
      foundCard.append(row)
    }

    const insertCard = el('section', 'ml-card')
    insertCard.append(el('h2', 'ml-label', 'Insert registered macro'))
    const macros = latestState?.macros ?? []
    if (!macros.length) insertCard.append(el('div', 'ml-meta', 'No registered macros yet. Open MacroLab to create one.'))
    for (const macro of macros) {
      const row = el('div', 'ml-ref')
      const main = el('div', 'ml-grow')
      main.append(el('strong', 'ml-title ml-code', `{{${macro.name}}}`), el('div', 'ml-meta', `${macro.decisions.length} sticky decision${macro.decisions.length === 1 ? '' : 's'}${macro.description ? ` · ${macro.description}` : ''}`))
      const insert = button('Insert')
      insert.addEventListener('click', () => {
        insertIntoEditable(target, `{{${macro.name}}}`)
        lastEditable = target
        renderPipette(surfaceLabel)
      })
      row.append(main, insert)
      insertCard.append(row)
    }

    body.append(header, targetCard, foundCard, insertCard)
    root.append(body)
  }

  const openPipette = (surfaceLabel: string) => {
    hotPlateModal?.dismiss?.()
    if (pipetteModal) pipetteModal.dismiss()
    pipetteModal = ctx.ui.showModal({ title: 'Pipette', width: 610, maxHeight: 760 })
    pipetteModal.onDismiss(() => {
      pipetteModal = null
      pipetteRender = null
    })
    pipetteRender = () => renderPipette(surfaceLabel)
    renderPipette(surfaceLabel)
    refreshState()
  }

  for (const surface of PIPETTE_SURFACES) mountLauncher(surface.point, `Open MacroLab Pipette for ${surface.label}`, () => openPipette(surface.label))

  // Backend messages ------------------------------------------------------
  const updateLaunchers = () => {
    const count = latestState?.decisions.length ?? 0
    for (const item of launcherNodes) {
      if (!item.badge) continue
      item.badge.textContent = count > 99 ? '99+' : String(count)
      item.badge.dataset.zero = String(count === 0)
      item.button.title = count ? `Open MacroLab Hot Plate · ${count} committed choices` : 'Open MacroLab Hot Plate'
    }
  }

  const applyState = (state: StateResult) => {
    latestState = state
    renderMacros(state)
    renderRawState(state)
    updateLaunchers()
    if (state.notice) setDrawerStatus(state.notice, 'success')
    else if (drawerSection !== 'resolution') setDrawerStatus('State refreshed.', 'success')
    if (!macroForm.hidden && editingMacroName) {
      const stillExists = state.macros.some((macro) => macro.name === editingMacroName)
      if (!stillExists) closeMacroForm()
    }
    hotPlateRender?.()
    pipetteRender?.()
  }

  const unsubscribeBackend = ctx.onBackendMessage((payload: BackendPayload) => {
    if (!payload || typeof payload !== 'object') return
    if (payload.type === 'macrolab:result') {
      const result = payload as ResolveResult
      if (result.requestId !== pendingResolve) return
      pendingResolve = ''
      resolveButton.disabled = false
      resolutionOutput.textContent = result.text
      copyOutput.disabled = result.text.length === 0
      diagnostics.replaceChildren()
      for (const diagnostic of result.diagnostics ?? []) {
        const item = el('li', '', `${diagnostic.message} · offset ${diagnostic.offset}`)
        diagnostics.append(item)
      }
      diagnostics.hidden = !result.diagnostics?.length
      setDrawerStatus(`Preview complete${result.context ? ` in ${result.context.name}` : ''}. Nothing new was committed.`, 'success')
      return
    }

    if (payload.type === 'macrolab:state') {
      const state = payload as StateResult
      pendingState.delete(state.requestId)
      applyState(state)
      if (!macroForm.hidden && state.notice?.startsWith('Saved ')) closeMacroForm()
      return
    }

    if (payload.type === 'macrolab:error') {
      const failure = payload as BackendError
      if (failure.requestId === pendingResolve) {
        pendingResolve = ''
        resolveButton.disabled = false
      }
      pendingState.delete(failure.requestId)
      setDrawerStatus(failure.error, 'error')
    }
  })
  cleanups.push(unsubscribeBackend)

  // Keep Hot Plate badge fresh after the host changes authoritative chat state.
  const refreshEvents = ['GENERATION_ENDED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'CHAT_CHANGED', 'CHAT_SELECTED']
  for (const eventName of refreshEvents) {
    try {
      const unsubscribe = ctx.events.on(eventName, () => {
        window.setTimeout(() => refreshState(), 40)
      })
      cleanups.push(unsubscribe)
    } catch {
      // Event availability varies by host version; fixed mounts still work without it.
    }
  }

  try {
    cleanups.push(tab.onActivate(() => refreshState()))
  } catch {
    // Older host build; initial/manual refresh remains available.
  }

  refreshState()

  return () => {
    hotPlateModal?.dismiss?.()
    pipetteModal?.dismiss?.()
    for (const cleanup of cleanups.reverse()) {
      try { cleanup() } catch { /* cleanup is best effort */ }
    }
  }
}
