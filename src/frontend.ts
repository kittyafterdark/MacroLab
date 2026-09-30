import { scanDecisionDescriptors, scanMacroReferences } from './core/decision-graph.js'
import type { DecisionState } from './core/state.js'
import {
  MACROLAB_BEAKER_ICON,
  MACROLAB_COAT_ICON,
  MACROLAB_HOT_PLATE_ICON,
  MACROLAB_LAUNCHER_ICON,
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

type SurfaceTarget = 'world-book-entry' | 'loom'

type SurfaceSpec = {
  point: string
  label: string
  target: SurfaceTarget
}

const HOT_PLATE_MOUNT_POINT = 'chat_actions'

const PIPETTE_SURFACES: SurfaceSpec[] = [
  { point: 'world_book_entry_editor', label: 'World Book entry', target: 'world-book-entry' },
  { point: 'loom_block_editor_actions', label: 'Loom block', target: 'loom' },
]

const MACRO_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
const COMMON_NATIVE_MACROS = new Set([
  'char', 'user', 'persona', 'system', 'date', 'time', 'weekday',
  'pick', 'random', 'getvar', 'setvar', 'getchatvar', 'setchatvar',
  'getglobalvar', 'setglobalvar', 'getlocalvar', 'setlocalvar',
])

const MACROLAB_GUIDE = `# MacroLab

MacroLab turns reusable prompt fragments into **chat-scoped, controllable choices**. The shortest useful loop is: **build a macro → test it → insert it into a prompt → generate → inspect the committed choices in Chat State / Hot Plate**.

## Five-minute tutorial

### 1. Create one small macro
Open **Library**, choose **New macro**, name it \`origin\`, and use this body:

\`\`\`text
Born {{pick::normally::from a ritual::from the sea}}.
\`\`\`

The **Recipe** section should detect one sticky choice.

### 2. Test it before saving
Choose **Test preview**. MacroLab uses the real resolver, but preview runs with \`commit:false\`: sampled values are temporary and **do not become chat canon**. Roll the preview again as much as you want.

### 3. Put the macro somewhere Lumi will resolve it
Save the macro, then insert \`{{origin}}\` into a Loom block or World Book entry. Pipette can insert registered macros directly from those editors.

### 4. Generate once
When a real generation resolves the macro, MacroLab commits its stochastic choices to the active chat. The same macro instance will keep using those values until you reroll or reset them.

### 5. Open Chat State / Hot Plate
You should now see \`origin · default\` and its committed choice. **Reroll** changes what future generations will use. **Lock** keeps a choice fixed. **Reset** forgets it so the next committing generation rolls again.

> Rerolling state does not rewrite an assistant message that already exists. It changes the state used by future generations.

## Preview vs committed state

- **Preview:** temporary test roll; nothing new is saved. Existing committed choices are still honored.
- **Generation:** committing resolve; new choices are stored in the active chat.
- **Hot Plate / Chat State:** controls the committed values that future generations will reuse.

## Instances

Use \`{{origin::alice}}\` and \`{{origin::bob}}\` when the same macro needs independent sticky state. Without arguments, the instance is \`default\`.

## Nested choices

MacroLab gives every \`pick\` / \`random\` node a stable decision ID. The Recipe view shows the possible decision graph; Chat State shows only choices that actually became committed state.

## Pipette

Pipette appears only on supported text-editing surfaces. It inspects the current field, shows macro references already present, and can insert or create registered macros without leaving the editor.

## Advanced variables

The **Advanced variables** section in Chat State exposes native Lumi local/chat/global variables. MacroLab's own decision storage stays hidden there and is managed through Chat State / Hot Plate instead.
`

type RecipeNode = {
  descriptor: ReturnType<typeof scanDecisionDescriptors>[number]
  depth: number
  raw: string
}

function recipeNodes(body: string): RecipeNode[] {
  const stochasticRefs = scanMacroReferences(body).filter((ref) => {
    const name = ref.name.toLowerCase()
    return name === 'pick' || name === 'random'
  })
  const descriptors = scanDecisionDescriptors(body)
  return stochasticRefs.map((ref, index) => {
    const end = ref.offset + ref.raw.length
    let depth = 0
    for (const parent of stochasticRefs) {
      if (parent === ref) continue
      const parentEnd = parent.offset + parent.raw.length
      if (parent.offset < ref.offset && parentEnd >= end) depth += 1
    }
    return { descriptor: descriptors[index], depth, raw: ref.raw }
  }).filter((node): node is RecipeNode => Boolean(node.descriptor))
}

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

  let ancestor: HTMLElement | null = target.parentElement
  for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
    const label = Array.from(ancestor.children).find((child) => child instanceof HTMLLabelElement) as HTMLLabelElement | undefined
    if (label?.textContent?.trim()) return label.textContent.trim().slice(0, 90)
    const nestedLabel = ancestor.querySelector<HTMLElement>(':scope > div > label')
    if (nestedLabel?.textContent?.trim()) return nestedLabel.textContent.trim().slice(0, 90)
  }

  if (target instanceof HTMLTextAreaElement) return 'Content'
  if (target instanceof HTMLInputElement) return 'Text field'
  return 'Editable field'
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

function visibleEditableCandidates(root: ParentNode = document): EditableTarget[] {
  return Array.from(root.querySelectorAll<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""]'))
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
  let quickMacroModal: any = null
  let quickMacroStatus: HTMLElement | null = null
  let quickMacroSaveButton: HTMLButtonElement | null = null
  let pendingQuickMacroSave: null | { requestId: string; name: string; afterSave?: (definition: MacroDefinitionView) => void } = null
  let pendingQuickMacroPreview: null | {
    requestId: string
    output: HTMLElement
    diagnostics: HTMLOListElement
    button: HTMLButtonElement
    status: HTMLElement
  } = null
  let pipetteRender: (() => void) | null = null
  let hotPlateRender: (() => void) | null = null
  let pendingMacroPreview = ''
  const pendingState = new Set<string>()
  let drawerSection: 'library' | 'state' = 'library'
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
    .ml-tabs { display:grid; grid-template-columns:repeat(2,1fr); gap:5px; padding:4px; position:sticky; top:0; z-index:5; backdrop-filter:blur(12px); background:var(--lumiverse-fill-subtle,rgba(127,127,127,.08)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.22)); border-radius:12px; }
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
    .ml-launcher { width:28px; height:28px; min-width:28px; padding:5px; border:0; border-radius:7px; background:transparent; color:inherit; opacity:.82; }
    .ml-launcher:hover:not(:disabled), .ml-launcher:focus-visible { opacity:1; background:var(--lumiverse-fill,rgba(127,127,127,.12)); }
    .ml-launcher:focus-visible { outline:1px solid var(--lumiverse-primary,currentColor); outline-offset:1px; }
    .ml-launcher .ml-icon { width:18px; height:18px; }
    [data-spindle-mount="chat_actions"] > [data-spindle-extension-root],
    [data-spindle-mount="loom_block_editor_actions"] > [data-spindle-extension-root] { display:inline-flex; align-items:center; }
    [data-spindle-mount="world_book_entry_editor"] > [data-spindle-extension-root] { display:flex; justify-content:flex-end; align-items:center; padding:0 0 6px; }
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
    .ml-surface-icon { width:44px; height:44px; flex:0 0 44px; display:grid; place-items:center; padding:5px; overflow:hidden; border:1px solid var(--lumiverse-border,rgba(127,127,127,.22)); border-radius:12px; background:var(--lumiverse-fill-subtle,rgba(127,127,127,.08)); color:var(--lumiverse-text,#f4f4f5); }
    .ml-surface-icon svg { width:100%; height:100%; display:block; color:inherit; }
    .ml-modal { display:flex; flex-direction:column; gap:11px; padding:2px 0 4px; color:var(--lumiverse-text,inherit); }
    .ml-notice { padding:8px 9px; border-radius:8px; background:var(--lumiverse-fill-subtle,rgba(127,127,127,.08)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.2)); font-size:10px; line-height:1.45; }
    .ml-status[data-kind="error"] { color:var(--lumiverse-danger,#d96a6a); }
    .ml-status[data-kind="success"] { color:var(--lumiverse-success,#73b886); }
    .ml-feedback[data-kind="error"] { color:var(--lumiverse-danger,#d96a6a); }
    .ml-feedback[data-kind="success"] { color:var(--lumiverse-success,#73b886); }
    .ml-ref { display:flex; gap:8px; align-items:flex-start; padding:8px; border-radius:8px; background:var(--lumiverse-fill,rgba(127,127,127,.05)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.18)); }
    .ml-ref-count { min-width:24px; text-align:center; }
    .ml-diagnostics { margin:0; padding:9px 9px 9px 25px; border:1px solid var(--lumiverse-border,rgba(127,127,127,.22)); border-radius:9px; font-size:10px; line-height:1.45; }
    .ml-recipe { display:flex; flex-direction:column; gap:6px; }
    .ml-recipe-row { display:flex; align-items:flex-start; gap:8px; padding:7px 8px; border-radius:8px; background:var(--lumiverse-fill,rgba(127,127,127,.045)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.16)); }
    .ml-recipe-row[data-depth="1"] { margin-left:14px; }
    .ml-recipe-row[data-depth="2"] { margin-left:28px; }
    .ml-recipe-row[data-depth="3"] { margin-left:42px; }
    .ml-preview-output { white-space:pre-wrap; overflow-wrap:anywhere; min-height:68px; margin:0; padding:10px; border-radius:9px; background:var(--lumiverse-fill,rgba(0,0,0,.16)); border:1px solid var(--lumiverse-border,rgba(127,127,127,.18)); font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; }
    .ml-advanced { border:1px solid var(--lumiverse-border,rgba(127,127,127,.2)); border-radius:10px; overflow:hidden; }
    .ml-advanced > summary { cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 10px; font-size:10px; font-weight:800; }
    .ml-advanced > summary::-webkit-details-marker { display:none; }
    .ml-advanced-body { display:flex; flex-direction:column; gap:9px; padding:0 10px 10px; }
    .ml-variable-scope { display:flex; flex-direction:column; gap:6px; }
    .ml-variable-row { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-top:1px solid var(--lumiverse-border,rgba(127,127,127,.14)); }
    .ml-variable-row:first-of-type { border-top:0; }
    .ml-variable-group { display:flex; flex-direction:column; gap:6px; }
    .ml-variable-group + .ml-variable-group { margin-top:4px; }
    .ml-variable-details { border-top:1px solid var(--lumiverse-border,rgba(127,127,127,.16)); padding-top:6px; }
    .ml-variable-details > summary { cursor:pointer; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 0; font-size:10px; font-weight:800; }
    .ml-variable-details > summary::-webkit-details-marker { display:none; }
    .ml-variable-details > summary::before { content:'▸'; width:12px; flex:0 0 12px; color:var(--lumiverse-text-muted,currentColor); }
    .ml-variable-details[open] > summary::before { content:'▾'; }
    .ml-variable-details-body { display:flex; flex-direction:column; gap:0; }
    .ml-subheading { font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--lumiverse-text-muted,currentColor); }
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
    if (payload.type !== 'macrolab:resolve' && payload.type !== 'macrolab:preview_macro') pendingState.add(id)
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

  const resolveEditable = (root: ParentNode = document): EditableTarget | null => {
    const rootNode = root instanceof Node ? root : null
    if (lastEditable?.isConnected && (!rootNode || rootNode.contains(lastEditable))) return lastEditable
    const candidates = visibleEditableCandidates(root)
    const textareas = candidates.filter((candidate): candidate is HTMLTextAreaElement => candidate instanceof HTMLTextAreaElement)
    if (textareas.length === 1) return textareas[0]
    return candidates.length === 1 ? candidates[0] : null
  }

  const resolveSurfaceEditable = (surface: SurfaceSpec, launcher: HTMLButtonElement): EditableTarget | null => {
    const extensionRoot = launcher.closest<HTMLElement>('[data-spindle-extension-root]')
    const anchor = extensionRoot?.parentElement?.matches(`[data-spindle-mount="${surface.point}"]`)
      ? extensionRoot.parentElement
      : document.querySelector<HTMLElement>(`[data-spindle-mount="${surface.point}"]`)

    let surfaceRoot: HTMLElement | null = null
    if (surface.target === 'world-book-entry') {
      surfaceRoot = anchor?.closest<HTMLElement>('[data-world-book-entry-editor="true"]') ?? null
    } else if (surface.target === 'loom') {
      surfaceRoot = anchor?.closest<HTMLElement>('[data-spindle-drawer-tab="loom"]') ?? null
    }

    if (!surfaceRoot) return null

    const rootNode = surfaceRoot as Node
    if (lastEditable?.isConnected && rootNode.contains(lastEditable)) return lastEditable
    const candidates = visibleEditableCandidates(surfaceRoot)
    const textareas = candidates.filter((candidate): candidate is HTMLTextAreaElement => candidate instanceof HTMLTextAreaElement)
    if (textareas.length === 1) return textareas[0]
    return null
  }

  // Drawer: MacroLab ------------------------------------------------------
  const tab = ctx.ui.registerDrawerTab({
    id: 'macro_lab',
    title: 'MacroLab',
    shortName: 'MacroLab',
    headerTitle: 'MacroLab',
    description: 'Build reusable macros and control the sticky choices they commit to a chat.',
    keywords: ['macro', 'pick', 'random', 'reroll', 'hot plate', 'pipette', 'variables', 'chat state'],
    iconSvg: MACROLAB_BEAKER_ICON,
    guide: {
      title: 'MacroLab tutorial',
      markdown: MACROLAB_GUIDE,
    },
  })
  cleanups.push(() => tab.destroy())

  const shell = el('section', 'ml-root ml-shell')
  const hero = el('section', 'ml-hero')
  const heroIcon = iconMarkup(MACROLAB_COAT_ICON, 'ml-hero-icon')
  const heroCopy = el('div', 'ml-hero-copy')
  heroCopy.append(
    el('strong', '', 'MacroLab'),
    el('span', 'ml-muted ml-small', 'Build a macro, test it here, then let real generations commit its choices to Chat State.'),
  )
  hero.append(heroIcon, heroCopy)

  const nav = el('div', 'ml-tabs')
  const navButtons = {
    library: button('Library', 'ml-tab'),
    state: button('Chat State', 'ml-tab'),
  }
  for (const [key, node] of Object.entries(navButtons)) {
    node.setAttribute('aria-selected', String(key === 'library'))
    nav.append(node)
  }

  const macrosPanel = el('section', 'ml-panel')
  const statePanel = el('section', 'ml-panel')
  statePanel.hidden = true

  const status = el('div', 'ml-status ml-small ml-muted', 'Loading MacroLab…')
  status.setAttribute('aria-live', 'polite')
  const setDrawerStatus = (text: string, kind: 'idle' | 'success' | 'error') => {
    status.textContent = text
    status.dataset.kind = kind
  }

  const switchDrawer = (section: 'library' | 'state') => {
    drawerSection = section
    macrosPanel.hidden = section !== 'library'
    statePanel.hidden = section !== 'state'
    for (const [key, node] of Object.entries(navButtons)) node.setAttribute('aria-selected', String(key === section))
    refreshState()
  }
  navButtons.library.addEventListener('click', () => switchDrawer('library'))
  navButtons.state.addEventListener('click', () => switchDrawer('state'))

  // Macro authoring -------------------------------------------------------
  const macrosToolbar = el('div', 'ml-heading')
  const libraryIntro = el('div', 'ml-grow')
  libraryIntro.append(
    el('strong', 'ml-title', 'Macro library'),
    el('div', 'ml-meta', 'Reusable prompt fragments. Test rolls are temporary; real generations create sticky chat state.'),
  )
  const newMacroButton = button('+ New macro', 'ml-button-primary')
  macrosToolbar.append(libraryIntro, newMacroButton)

  const macroForm = el('section', 'ml-card')
  macroForm.hidden = true
  const macroName = el('input', 'ml-input')
  macroName.placeholder = 'backstory'
  const macroDescription = el('input', 'ml-input')
  macroDescription.placeholder = 'Optional description'
  const macroBody = el('textarea', 'ml-editor ml-editor-large')
  macroBody.spellcheck = false
  macroBody.placeholder = 'Born {{pick::normally::from a ritual::from the sea}}.'

  const macroSummary = el('div', 'ml-small ml-muted')
  const recipeCard = el('section', 'ml-card ml-card-flat')
  const recipeHeading = el('div', 'ml-heading')
  const recipeCount = el('span', 'ml-pill', '0 decisions')
  recipeHeading.append(el('h2', 'ml-label', 'Recipe'), recipeCount)
  const recipeList = el('div', 'ml-recipe')
  recipeCard.append(recipeHeading, recipeList)

  const previewCard = el('section', 'ml-card ml-card-flat')
  const previewHeading = el('div', 'ml-heading')
  previewHeading.append(el('h2', 'ml-label', 'Test preview'))
  const previewNote = el('div', 'ml-notice', 'Preview uses the real MacroLab resolver with commit:false. New rolls here are temporary and never become chat canon.')
  const macroPreviewOutput = el('pre', 'ml-preview-output', 'Run a preview to see this macro resolve without committing new state.')
  const macroPreviewDiagnostics = el('ol', 'ml-diagnostics')
  macroPreviewDiagnostics.hidden = true
  const previewActions = el('div', 'ml-actions')
  const previewMacro = button('Test preview', 'ml-button-primary')
  const copyMacroPreview = button('Copy')
  copyMacroPreview.disabled = true
  previewActions.append(previewMacro, copyMacroPreview)
  previewCard.append(previewHeading, previewNote, macroPreviewOutput, macroPreviewDiagnostics, previewActions)

  const macroFormActions = el('div', 'ml-actions')
  const saveMacro = button('Save macro', 'ml-button-primary')
  const cancelMacro = button('Cancel')
  macroFormActions.append(saveMacro, cancelMacro)
  macroForm.replaceChildren(
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Macro name'), macroName); return f })(),
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Description'), macroDescription); return f })(),
    (() => { const f = el('div', 'ml-field'); f.append(el('label', '', 'Macro body'), macroBody); return f })(),
    macroSummary,
    recipeCard,
    previewCard,
    macroFormActions,
  )

  const macroList = el('div', 'ml-grid')
  const macrosCard = el('section', 'ml-card')
  const macroHeading = el('div', 'ml-heading')
  macroHeading.append(el('h2', 'ml-label', 'Registered macros'), el('span', 'ml-small ml-muted', 'Edit, inspect, or insert a saved definition'))
  macrosCard.append(macroHeading, macroList)
  macrosPanel.append(macrosToolbar, macroForm, macrosCard)

  const resetMacroPreview = () => {
    pendingMacroPreview = ''
    previewMacro.disabled = false
    previewMacro.textContent = 'Test preview'
    macroPreviewOutput.textContent = 'Run a preview to see this macro resolve without committing new state.'
    macroPreviewDiagnostics.replaceChildren()
    macroPreviewDiagnostics.hidden = true
    copyMacroPreview.disabled = true
  }

  const renderRecipe = () => {
    const nodes = recipeNodes(macroBody.value)
    const refs = scanMacroReferences(macroBody.value)
    const nestedMacros = refs.filter((ref) => !['pick', 'random'].includes(ref.name.toLowerCase())).length
    macroSummary.textContent = `${macroBody.value.length.toLocaleString()} characters · ${nodes.length} sticky decision${nodes.length === 1 ? '' : 's'} · ${nestedMacros} other macro reference${nestedMacros === 1 ? '' : 's'}`
    recipeCount.textContent = `${nodes.length} decision${nodes.length === 1 ? '' : 's'}`
    recipeList.replaceChildren()
    if (!nodes.length) {
      recipeList.append(el('div', 'ml-empty', 'No sticky pick/random nodes yet. Plain macros are fine; add a stochastic node when you want chat-scoped choices.'))
      return
    }
    for (const node of nodes) {
      const row = el('div', 'ml-recipe-row')
      row.dataset.depth = String(Math.min(node.depth, 3))
      const main = el('div', 'ml-grow')
      const line = el('div', 'ml-inline')
      line.append(el('strong', 'ml-title', node.descriptor.label), el('span', 'ml-pill', node.descriptor.kind))
      main.append(line, el('div', 'ml-meta ml-code', node.raw.length > 120 ? `${node.raw.slice(0, 117)}…` : node.raw))
      row.append(main)
      recipeList.append(row)
    }
  }

  const openMacroForm = (definition?: MacroDefinitionView) => {
    editingMacroName = definition?.name ?? null
    macroName.value = definition?.name ?? ''
    macroDescription.value = definition?.description ?? ''
    macroBody.value = definition?.body ?? ''
    macroForm.hidden = false
    resetMacroPreview()
    renderRecipe()
    macroName.focus()
  }
  const closeMacroForm = () => {
    editingMacroName = null
    macroForm.hidden = true
    macroName.value = ''
    macroDescription.value = ''
    macroBody.value = ''
    resetMacroPreview()
  }

  macroBody.addEventListener('input', () => {
    renderRecipe()
    if (macroPreviewOutput.textContent !== 'Run a preview to see this macro resolve without committing new state.') {
      macroPreviewOutput.textContent = 'Body changed. Run another preview to test the current draft.'
      copyMacroPreview.disabled = true
    }
  })
  newMacroButton.addEventListener('click', () => openMacroForm())
  cancelMacro.addEventListener('click', closeMacroForm)

  const doMacroPreview = () => {
    const name = macroName.value.trim()
    if (!name || !macroBody.value.trim()) {
      setDrawerStatus('Give the macro a name and body before testing it.', 'error')
      return
    }
    if (!MACRO_NAME_RE.test(name)) {
      setDrawerStatus('Names must start with a letter and contain only letters, numbers, _ or -.', 'error')
      return
    }
    pendingMacroPreview = requestId()
    previewMacro.disabled = true
    previewMacro.textContent = 'Previewing…'
    setDrawerStatus('Rolling a temporary preview. Nothing new will be committed.', 'idle')
    ctx.sendToBackend({
      type: 'macrolab:preview_macro',
      requestId: pendingMacroPreview,
      name,
      body: macroBody.value,
    })
  }
  previewMacro.addEventListener('click', doMacroPreview)
  macroBody.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      doMacroPreview()
    }
  })
  copyMacroPreview.addEventListener('click', async () => {
    const text = macroPreviewOutput.textContent ?? ''
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else if (!copyTextFallback(text)) throw new Error('copy failed')
      setDrawerStatus('Copied preview output.', 'success')
    } catch {
      setDrawerStatus('Clipboard copy failed; select the preview manually.', 'error')
    }
  })

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

  const openSurfaceMacroForm = (options: {
    definition?: MacroDefinitionView
    initialName?: string
    afterSave?: (definition: MacroDefinitionView) => void
  } = {}) => {
    const returnTarget = lastEditable?.isConnected ? lastEditable : null
    quickMacroModal?.dismiss?.()
    const definition = options.definition
    quickMacroModal = ctx.ui.showModal({ title: definition ? `Edit {{${definition.name}}}` : 'Create MacroLab macro', width: 620, maxHeight: 760 })
    const root = quickMacroModal.root as HTMLElement
    const form = el('section', 'ml-root ml-modal')
    const header = el('div', 'ml-surface-header')
    header.append(iconMarkup(MACROLAB_BEAKER_ICON, 'ml-surface-icon'))
    const headerCopy = el('div', 'ml-grow')
    headerCopy.append(
      el('strong', 'ml-title', definition ? 'Edit registered macro' : 'Create registered macro'),
      el('div', 'ml-meta', 'Create it here; MacroLab proper is for the full workshop, not a prerequisite.'),
    )
    header.append(headerCopy)

    const nameInput = el('input', 'ml-input')
    nameInput.placeholder = 'backstory'
    nameInput.value = definition?.name ?? options.initialName ?? ''
    const descriptionInput = el('input', 'ml-input')
    descriptionInput.placeholder = 'Optional description'
    descriptionInput.value = definition?.description ?? ''
    const bodyInput = el('textarea', 'ml-editor ml-editor-large')
    bodyInput.spellcheck = false
    bodyInput.placeholder = 'Born in {{pick::a coastal city::a mountain village}}…'
    bodyInput.value = definition?.body ?? ''
    const previewSummary = el('div', 'ml-small ml-muted')
    const statusLine = el('div', 'ml-small ml-muted ml-feedback')
    statusLine.setAttribute('aria-live', 'polite')
    quickMacroStatus = statusLine
    const quickOutput = el('pre', 'ml-preview-output', 'Optional: test this draft before saving. Preview never commits new chat state.')
    const quickDiagnostics = el('ol', 'ml-diagnostics')
    quickDiagnostics.hidden = true
    const updatePreview = () => {
      const nodes = recipeNodes(bodyInput.value)
      const refs = scanMacroReferences(bodyInput.value)
      const otherRefs = refs.filter((ref) => !['pick', 'random'].includes(ref.name.toLowerCase())).length
      previewSummary.textContent = `${bodyInput.value.length.toLocaleString()} characters · ${nodes.length} sticky decision${nodes.length === 1 ? '' : 's'} · ${otherRefs} other macro reference${otherRefs === 1 ? '' : 's'}`
      if (pendingQuickMacroPreview) return
      if (quickOutput.textContent !== 'Optional: test this draft before saving. Preview never commits new chat state.') {
        quickOutput.textContent = 'Draft changed. Run another preview to test the current body.'
      }
    }
    bodyInput.addEventListener('input', updatePreview)
    updatePreview()

    const actions = el('div', 'ml-actions')
    const test = button('Test preview')
    const save = button(definition ? 'Save changes' : 'Create macro', 'ml-button-primary')
    quickMacroSaveButton = save
    const cancel = button('Cancel')
    actions.append(test, save, cancel)
    test.addEventListener('click', () => {
      const name = nameInput.value.trim()
      if (!name || !bodyInput.value.trim()) {
        statusLine.textContent = 'Give the macro a name and body before testing it.'
        statusLine.dataset.kind = 'error'
        return
      }
      if (!MACRO_NAME_RE.test(name)) {
        statusLine.textContent = 'Names must start with a letter and contain only letters, numbers, _ or -.'
        statusLine.dataset.kind = 'error'
        return
      }
      test.disabled = true
      statusLine.textContent = 'Rolling temporary preview…'
      statusLine.dataset.kind = 'idle'
      const id = requestId()
      pendingQuickMacroPreview = { requestId: id, output: quickOutput, diagnostics: quickDiagnostics, button: test, status: statusLine }
      ctx.sendToBackend({ type: 'macrolab:preview_macro', requestId: id, name, body: bodyInput.value })
    })
    cancel.addEventListener('click', () => quickMacroModal?.dismiss?.())
    save.addEventListener('click', () => {
      const name = nameInput.value.trim()
      if (!name || !bodyInput.value.trim()) {
        statusLine.textContent = 'Macro name and body are required.'
        statusLine.dataset.kind = 'error'
        return
      }
      if (!MACRO_NAME_RE.test(name)) {
        statusLine.textContent = 'Names must start with a letter and contain only letters, numbers, _ or -.'
        statusLine.dataset.kind = 'error'
        return
      }
      save.disabled = true
      statusLine.textContent = 'Saving…'
      const id = send({
        type: 'macrolab:save_macro',
        originalName: definition?.name,
        definition: { name, description: descriptionInput.value, body: bodyInput.value },
      })
      pendingQuickMacroSave = { requestId: id, name, afterSave: options.afterSave }
    })

    const field = (label: string, control: HTMLElement) => {
      const wrapper = el('div', 'ml-field')
      wrapper.append(el('label', '', label), control)
      return wrapper
    }
    form.append(header, field('Macro name', nameInput), field('Description', descriptionInput), field('Macro body', bodyInput), previewSummary, quickOutput, quickDiagnostics, statusLine, actions)
    root.replaceChildren(form)
    quickMacroModal.onDismiss(() => {
      if (pendingQuickMacroSave) pendingQuickMacroSave.afterSave = undefined
      pendingQuickMacroPreview = null
      if (returnTarget?.isConnected) lastEditable = returnTarget
      quickMacroModal = null
      quickMacroStatus = null
      quickMacroSaveButton = null
    })
    nameInput.focus()
  }

  // Chat State ------------------------------------------------------------
  const stateContext = el('div', 'ml-notice', 'No active chat loaded yet.')
  const rawDecisionList = el('div', 'ml-grid')
  const variableList = el('div', 'ml-grid')
  const stateRefresh = button('Refresh')
  stateRefresh.addEventListener('click', () => refreshState(false))
  const stateTop = el('div', 'ml-heading')
  const stateHeadingCopy = el('div', 'ml-grow')
  stateHeadingCopy.append(
    el('h2', 'ml-label', 'Committed chat state'),
    el('div', 'ml-meta', 'These are the sticky choices real generations have committed. Rerolls affect future generations; existing messages are not rewritten.'),
  )
  stateTop.append(stateHeadingCopy, stateRefresh)
  const rawStateCard = el('section', 'ml-card')
  rawStateCard.append(stateTop, stateContext, rawDecisionList)

  const advancedVariables = el('details', 'ml-advanced')
  const advancedSummary = el('summary')
  advancedSummary.append(el('span', '', 'Advanced variables'), el('span', 'ml-pill', 'debug / power user'))
  const advancedBody = el('div', 'ml-advanced-body')
  advancedBody.append(
    el('div', 'ml-small ml-muted', 'Native Lumi local/chat/global variables. MacroLab decision storage is intentionally hidden here and managed above.'),
    variableList,
  )
  advancedVariables.append(advancedSummary, advancedBody)
  statePanel.append(rawStateCard, advancedVariables)

  shell.append(hero, nav, macrosPanel, statePanel, status)
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
      container.append(el('div', 'ml-empty', 'No committed MacroLab choices yet. Test previews are temporary; insert a saved macro into a prompt and run a real generation to create Chat State.'))
      return
    }

    for (const [, items] of groupedDecisions(state)) {
      const first = items[0].state
      const group = el('section', 'ml-instance')
      const heading = el('div', 'ml-heading')
      const left = el('div', 'ml-grow')
      left.append(el('div', 'ml-title ml-code', `${first.macroName} · ${first.instance}`), el('div', 'ml-meta', `${items.length} committed decision${items.length === 1 ? '' : 's'} · ${items.filter((item) => item.state.locked).length} locked`))
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
      macroList.append(el('div', 'ml-empty', 'No macros yet. Create one, test it in place, then insert it into Loom or a World Book entry. The drawer guide has a five-minute tutorial.'))
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
      const test = button('Test')
      const insert = button('Insert')
      const edit = button('Edit')
      const remove = button('Delete', 'ml-button-danger')
      test.addEventListener('click', () => {
        openMacroForm(definition)
        doMacroPreview()
      })
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
      actions.append(test, insert, edit, remove)
      card.append(main, actions)
      macroList.append(card)
    }
  }

  const variableAction = (scope: VariableScope, action: 'set' | 'delete', key: string, value?: string, authored = false) => {
    send({ type: 'macrolab:variable_action', scope, action, key, value, authored }, `${action === 'set' ? 'Updating' : 'Deleting'} ${scope} variable…`)
  }

  const renderVariables = (state: StateResult | null) => {
    variableList.replaceChildren()
    const snapshot = state?.variables ?? { local: {}, chat: {}, global: {} }
    const ownedSnapshot = state?.authoredVariables ?? { local: [], chat: [], global: [] }

    const appendVariableRow = (parent: HTMLElement, scope: VariableScope, key: string, value: string, owned: boolean) => {
      const row = el('div', 'ml-variable-row')
      const main = el('div', 'ml-grow')
      const title = el('div', 'ml-inline')
      title.append(el('div', 'ml-title ml-code', `${scopePrefix(scope)}${key}`))
      if (owned) title.append(el('span', 'ml-pill', 'MacroLab'))
      main.append(title, el('div', 'ml-value', value === '' ? '""' : value))
      const actions = el('div', 'ml-actions')
      const edit = button('Edit')
      const remove = button('Delete', 'ml-button-danger')
      edit.addEventListener('click', () => {
        const next = window.prompt(`Value for ${scopePrefix(scope)}${key}:`, value)
        if (next !== null) variableAction(scope, 'set', key, next, owned)
      })
      remove.addEventListener('click', async () => {
        if (!owned) {
          const result = await ctx.ui.showConfirm({
            title: `Delete ${scopePrefix(scope)}${key}?`,
            message: 'MacroLab did not create this variable. It may belong to a preset or another extension.',
            variant: 'danger',
            confirmLabel: 'Delete variable',
          })
          if (!result?.confirmed) return
        }
        variableAction(scope, 'delete', key)
      })
      actions.append(edit, remove)
      row.append(main, actions)
      parent.append(row)
    }

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
        variableAction(scope, 'set', key, value, true)
      })
      section.append(heading)

      const entries = Object.entries(snapshot[scope]).sort(([a], [b]) => a.localeCompare(b))
      const owned = new Set(ownedSnapshot[scope])
      const authoredEntries = entries.filter(([key]) => owned.has(key))
      const externalEntries = entries.filter(([key]) => !owned.has(key))

      const authoredGroup = el('div', 'ml-variable-group')
      authoredGroup.append(el('div', 'ml-subheading', 'MacroLab variables'))
      if (!authoredEntries.length) authoredGroup.append(el('div', 'ml-meta', 'No variables created here yet.'))
      for (const [key, value] of authoredEntries) appendVariableRow(authoredGroup, scope, key, value, true)
      section.append(authoredGroup)

      if (externalEntries.length) {
        const details = el('details', 'ml-variable-details')
        const summary = el('summary')
        summary.append(el('span', '', `Other ${scope} variables`), el('span', 'ml-pill', String(externalEntries.length)))
        const body = el('div', 'ml-variable-details-body')
        for (const [key, value] of externalEntries) appendVariableRow(body, scope, key, value, false)
        details.append(summary, body)
        section.append(details)
      } else if (!entries.length) {
        section.append(el('div', 'ml-meta', `No other ${scope} variables detected.`))
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
    copy.append(el('strong', 'ml-title', 'Hot Plate'), el('div', 'ml-meta', latestState?.context ? `${latestState.context.name} · committed choices for future generations` : 'No active chat'))
    header.append(copy)
    const toolbar = el('div', 'ml-actions')
    const createMacro = button('+ New macro', 'ml-button-primary')
    const refresh = button('Refresh')
    const openLab = button('Open MacroLab')
    createMacro.addEventListener('click', () => {
      hotPlateModal?.dismiss?.()
      openSurfaceMacroForm()
    })
    refresh.addEventListener('click', () => refreshState(false))
    openLab.addEventListener('click', () => {
      hotPlateModal?.dismiss()
      tab.activate()
      switchDrawer('state')
    })
    toolbar.append(createMacro, refresh, openLab)
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
  const mountLauncher = (point: string, label: string, onClick: (button: HTMLButtonElement) => void, withBadge = false): HTMLButtonElement | null => {
    try {
      const host = ctx.ui.mount(point)
      const node = iconButton(MACROLAB_LAUNCHER_ICON, label, 'ml-launcher')
      let badge: HTMLElement | undefined
      if (withBadge) {
        badge = el('span', 'ml-badge', '0')
        badge.dataset.zero = 'true'
        node.append(badge)
      }
      node.addEventListener('click', () => onClick(node))
      host.append(node)
      launcherNodes.push({ button: node, badge })
      cleanups.push(() => node.remove())
      return node
    } catch (error) {
      console.warn(`[MacroLab] Could not mount ${point}:`, error)
      return null
    }
  }

  // The action-row mount is the actual composer control strip. The old chat_toolbar
  // point is a second row below it, which made Hot Plate look detached from Send.
  mountLauncher(HOT_PLATE_MOUNT_POINT, 'Open MacroLab Hot Plate', () => openHotPlate(), true)

  // Pipette ---------------------------------------------------------------
  const renderPipette = (surface: SurfaceSpec, launcher: HTMLButtonElement) => {
    const surfaceLabel = surface.label
    if (!pipetteModal) return
    const root = pipetteModal.root as HTMLElement
    root.replaceChildren()
    const body = el('section', 'ml-root ml-modal')
    const header = el('div', 'ml-surface-header')
    header.append(iconMarkup(MACROLAB_PIPETTE_ICON, 'ml-surface-icon'))
    const headerCopy = el('div', 'ml-grow')
    headerCopy.append(el('strong', 'ml-title', 'Pipette'), el('div', 'ml-meta', `Contextual macro inspection · ${surfaceLabel}`))
    header.append(headerCopy)

    const target = resolveSurfaceEditable(surface, launcher)
    if (!target) {
      body.append(header, el('div', 'ml-empty', 'Focus the text field you want to inspect, then open Pipette again. If several editors are visible, MacroLab refuses to guess which one you meant.'))
      root.append(body)
      return
    }

    const text = editableText(target)
    const refs = scanMacroReferences(text)
    const macroMap = new Map((latestState?.macros ?? []).map((macro) => [macro.name.toLowerCase(), macro]))
    type PipetteItem = {
      name: string
      args: string[]
      count: number
      definition?: MacroDefinitionView
      kind: 'registered' | 'stochastic' | 'native' | 'external'
    }
    const counts = new Map<string, PipetteItem>()
    for (const ref of refs) {
      const lower = ref.name.toLowerCase()
      const definition = macroMap.get(lower)
      const kind: PipetteItem['kind'] = definition
        ? 'registered'
        : (lower === 'pick' || lower === 'random')
          ? 'stochastic'
          : COMMON_NATIVE_MACROS.has(lower)
            ? 'native'
            : 'external'
      const args = definition ? ref.args.map((value) => String(value ?? '').trim()).filter(Boolean) : []
      const key = `${lower}\u0000${args.join('::')}`
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { name: ref.name, args, count: 1, definition, kind })
    }

    const targetCard = el('section', 'ml-card')
    targetCard.append(
      el('h2', 'ml-label', 'Current surface'),
      el('div', 'ml-title', `${surfaceLabel} · ${targetLabel(target)}`),
      el('div', 'ml-meta', `${text.length.toLocaleString()} characters · ${refs.length} macro reference${refs.length === 1 ? '' : 's'}`),
    )

    const foundCard = el('section', 'ml-card')
    foundCard.append(el('h2', 'ml-label', 'Detected here'))
    if (!counts.size) foundCard.append(el('div', 'ml-empty', 'No macro references in this field yet. Insert an existing macro below or create one here.'))
    for (const item of [...counts.values()].sort((a, b) => `${a.name}\u0000${a.args.join('::')}`.localeCompare(`${b.name}\u0000${b.args.join('::')}`))) {
      const row = el('div', 'ml-ref')
      const count = el('span', 'ml-pill ml-ref-count', String(item.count))
      const main = el('div', 'ml-grow')
      const title = el('div', 'ml-inline')
      const invocation = item.args.length ? `${item.name} · ${item.args.join('::')}` : item.name
      title.append(el('strong', 'ml-title', invocation), el('span', 'ml-pill', item.kind === 'external' ? 'not in MacroLab' : item.kind))
      if (item.definition) title.append(el('span', 'ml-pill', `${item.definition.decisions.length} sticky`))
      const rawRef = item.args.length ? `{{${item.name}::${item.args.join('::')}}}` : `{{${item.name}}}`
      const meta = item.definition
        ? `${rawRef} · ${item.definition.description || `${item.definition.body.length.toLocaleString()} character registered macro`}`
        : item.kind === 'stochastic'
          ? `${rawRef} · inline stochastic macro`
          : item.kind === 'native'
            ? `${rawRef} · native macro`
            : `${rawRef} · external or unregistered macro reference`
      main.append(title, el('div', 'ml-meta', meta))
      const actions = el('div', 'ml-actions')
      if (item.definition) {
        const edit = button('Edit')
        edit.addEventListener('click', () => openSurfaceMacroForm({ definition: item.definition }))
        actions.append(edit)
      } else if (item.kind === 'external' && MACRO_NAME_RE.test(item.name)) {
        const create = button('Create definition', 'ml-button-primary')
        create.addEventListener('click', () => openSurfaceMacroForm({ initialName: item.name }))
        actions.append(create)
      }
      row.append(count, main, actions)
      foundCard.append(row)
    }

    const insertCard = el('section', 'ml-card')
    const insertHeading = el('div', 'ml-heading')
    insertHeading.append(el('h2', 'ml-label', 'Insert registered macro'))
    const createNew = button('+ New macro')
    createNew.addEventListener('click', () => openSurfaceMacroForm({
      afterSave: (definition) => {
        if (!target.isConnected) return
        insertIntoEditable(target, `{{${definition.name}}}`)
        lastEditable = target
      },
    }))
    insertHeading.append(createNew)
    insertCard.append(insertHeading)
    const macros = latestState?.macros ?? []
    if (!macros.length) insertCard.append(el('div', 'ml-meta', 'No registered macros yet. Create one here and Pipette can insert it without leaving this editor.'))
    for (const macro of macros) {
      const row = el('div', 'ml-ref')
      const main = el('div', 'ml-grow')
      main.append(el('strong', 'ml-title ml-code', `{{${macro.name}}}`), el('div', 'ml-meta', `${macro.decisions.length} sticky decision${macro.decisions.length === 1 ? '' : 's'}${macro.description ? ` · ${macro.description}` : ''}`))
      const actions = el('div', 'ml-actions')
      const insert = button('Insert')
      const edit = button('Edit')
      insert.addEventListener('click', () => {
        insertIntoEditable(target, `{{${macro.name}}}`)
        lastEditable = target
        renderPipette(surface, launcher)
      })
      edit.addEventListener('click', () => openSurfaceMacroForm({ definition: macro }))
      actions.append(insert, edit)
      row.append(main, actions)
      insertCard.append(row)
    }

    body.append(header, targetCard, foundCard, insertCard)
    root.append(body)
  }

  const openPipette = (surface: SurfaceSpec, launcher: HTMLButtonElement) => {
    hotPlateModal?.dismiss?.()
    if (pipetteModal) pipetteModal.dismiss()
    pipetteModal = ctx.ui.showModal({ title: 'Pipette', width: 610, maxHeight: 760 })
    pipetteModal.onDismiss(() => {
      pipetteModal = null
      pipetteRender = null
    })
    pipetteRender = () => renderPipette(surface, launcher)
    renderPipette(surface, launcher)
    refreshState()
  }

  for (const surface of PIPETTE_SURFACES) {
    mountLauncher(surface.point, `Open MacroLab Pipette for ${surface.label}`, (launcher) => openPipette(surface, launcher))
  }

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
    if (pendingQuickMacroSave?.requestId === state.requestId && state.notice?.startsWith('Saved ')) {
      const pending = pendingQuickMacroSave
      pendingQuickMacroSave = null
      const definition = state.macros.find((macro) => macro.name === pending.name)
      quickMacroModal?.dismiss?.()
      if (definition) pending.afterSave?.(definition)
    }
    renderMacros(state)
    renderRawState(state)
    updateLaunchers()
    if (state.notice) setDrawerStatus(state.notice, 'success')
    else setDrawerStatus('State refreshed.', 'success')
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
      if (pendingQuickMacroPreview?.requestId === result.requestId) {
        const pending = pendingQuickMacroPreview
        pendingQuickMacroPreview = null
        pending.button.disabled = false
        pending.button.textContent = 'Roll preview again'
        pending.output.textContent = result.text || '(empty output)'
        pending.diagnostics.replaceChildren()
        for (const diagnostic of result.diagnostics ?? []) {
          pending.diagnostics.append(el('li', '', `${diagnostic.message} · offset ${diagnostic.offset}`))
        }
        pending.diagnostics.hidden = !result.diagnostics?.length
        pending.status.textContent = `Preview complete${result.context ? ` in ${result.context.name}` : ''}. Nothing new was committed.`
        pending.status.dataset.kind = 'success'
        return
      }
      if (result.requestId !== pendingMacroPreview) return
      pendingMacroPreview = ''
      previewMacro.disabled = false
      previewMacro.textContent = 'Roll preview again'
      macroPreviewOutput.textContent = result.text || '(empty output)'
      copyMacroPreview.disabled = result.text.length === 0
      macroPreviewDiagnostics.replaceChildren()
      for (const diagnostic of result.diagnostics ?? []) {
        const item = el('li', '', `${diagnostic.message} · offset ${diagnostic.offset}`)
        macroPreviewDiagnostics.append(item)
      }
      macroPreviewDiagnostics.hidden = !result.diagnostics?.length
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
      if (pendingQuickMacroPreview?.requestId === failure.requestId) {
        const pending = pendingQuickMacroPreview
        pendingQuickMacroPreview = null
        pending.button.disabled = false
        pending.button.textContent = 'Test preview'
        pending.status.textContent = failure.error
        pending.status.dataset.kind = 'error'
      }
      if (failure.requestId === pendingMacroPreview) {
        pendingMacroPreview = ''
        previewMacro.disabled = false
        previewMacro.textContent = 'Test preview'
      }
      pendingState.delete(failure.requestId)
      if (pendingQuickMacroSave?.requestId === failure.requestId) {
        pendingQuickMacroSave = null
        if (quickMacroStatus) {
          quickMacroStatus.textContent = failure.error
          quickMacroStatus.dataset.kind = 'error'
        }
        if (quickMacroSaveButton) quickMacroSaveButton.disabled = false
      }
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
    quickMacroModal?.dismiss?.()
    for (const cleanup of cleanups.reverse()) {
      try { cleanup() } catch { /* cleanup is best effort */ }
    }
  }
}
