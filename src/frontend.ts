type MacroDiagnostic = {
  message: string
  offset: number
  length: number
}

type ResolveResult = {
  type: 'lumi_macro_lab:result'
  requestId: string
  text: string
  diagnostics: MacroDiagnostic[]
  context: null | {
    name: string
    hasCharacter: boolean
  }
}

type ResolveError = {
  type: 'lumi_macro_lab:error'
  requestId: string
  error: string
}

type BackendPayload = ResolveResult | ResolveError | Record<string, unknown>

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length))
  const before = text.slice(0, safeOffset)
  const lines = before.split('\n')

  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
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

export function setup(ctx: any) {
  const removeStyle = ctx.dom.addStyle(`
    .lml-shell,
    .lml-shell * {
      box-sizing: border-box;
    }

    .lml-shell {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 100%;
      padding: 14px;
      color: var(--lumiverse-text, inherit);
    }

    .lml-intro {
      margin: 0;
      color: var(--lumiverse-text-muted, color-mix(in srgb, currentColor 68%, transparent));
      font-size: 12px;
      line-height: 1.55;
    }

    .lml-card {
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 12px;
      background: var(--lumiverse-fill-subtle, rgba(127, 127, 127, 0.08));
      border: 1px solid var(--lumiverse-border, rgba(127, 127, 127, 0.24));
      border-radius: var(--lumiverse-radius, 12px);
    }

    .lml-heading-row,
    .lml-actions,
    .lml-status-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .lml-heading-row,
    .lml-status-row {
      justify-content: space-between;
    }

    .lml-label {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .lml-hint,
    .lml-status {
      color: var(--lumiverse-text-muted, color-mix(in srgb, currentColor 68%, transparent));
      font-size: 11px;
      line-height: 1.4;
    }

    .lml-editor,
    .lml-output {
      width: 100%;
      min-height: 190px;
      margin: 0;
      padding: 11px 12px;
      resize: vertical;
      overflow: auto;
      background: var(--lumiverse-fill, rgba(0, 0, 0, 0.16));
      border: 1px solid var(--lumiverse-border, rgba(127, 127, 127, 0.3));
      border-radius: calc(var(--lumiverse-radius, 12px) - 3px);
      color: var(--lumiverse-text, inherit);
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      tab-size: 2;
    }

    .lml-editor:focus {
      outline: 2px solid color-mix(in srgb, var(--lumiverse-primary, currentColor) 45%, transparent);
      outline-offset: 1px;
    }

    .lml-editor::placeholder {
      color: var(--lumiverse-text-muted, color-mix(in srgb, currentColor 55%, transparent));
    }

    .lml-output {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
    }

    .lml-output[data-empty="true"] {
      color: var(--lumiverse-text-muted, color-mix(in srgb, currentColor 55%, transparent));
    }

    .lml-button {
      appearance: none;
      min-height: 34px;
      padding: 7px 11px;
      cursor: pointer;
      background: var(--lumiverse-fill, rgba(127, 127, 127, 0.12));
      border: 1px solid var(--lumiverse-border, rgba(127, 127, 127, 0.3));
      border-radius: calc(var(--lumiverse-radius, 12px) - 4px);
      color: var(--lumiverse-text, inherit);
      font: inherit;
      font-size: 12px;
      font-weight: 650;
    }

    .lml-button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--lumiverse-fill, currentColor) 82%, currentColor 8%);
    }

    .lml-button:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--lumiverse-primary, currentColor) 45%, transparent);
      outline-offset: 1px;
    }

    .lml-button-primary {
      background: var(--lumiverse-primary, currentColor);
      border-color: transparent;
      color: var(--lumiverse-primary-foreground, Canvas);
    }

    .lml-button-primary:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    .lml-button:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }

    .lml-spacer {
      flex: 1;
    }

    .lml-diagnostics {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 10px 10px 10px 28px;
      background: var(--lumiverse-fill, rgba(0, 0, 0, 0.12));
      border: 1px solid var(--lumiverse-border, rgba(127, 127, 127, 0.26));
      border-radius: calc(var(--lumiverse-radius, 12px) - 3px);
      font-size: 12px;
      line-height: 1.45;
    }

    .lml-diagnostics[hidden] {
      display: none;
    }

    .lml-status[data-state="error"] {
      color: var(--lumiverse-danger, #d96a6a);
    }

    .lml-status[data-state="success"] {
      color: var(--lumiverse-success, #73b886);
    }

    @media (max-width: 520px) {
      .lml-shell {
        padding: 10px;
      }

      .lml-actions {
        flex-wrap: wrap;
      }

      .lml-button-primary {
        flex: 1 1 120px;
      }

      .lml-editor,
      .lml-output {
        min-height: 165px;
      }
    }
  `)

  const tab = ctx.ui.registerDrawerTab({
    id: 'macro_lab',
    title: 'Macro Resolution Preview',
    shortName: 'Macros',
    headerTitle: 'Macro Lab',
    description: 'Preview Lumiverse macro resolution without saving anything',
    keywords: ['macro', 'resolve', 'preview', 'prompt', 'debug', 'loom'],
    iconSvg: `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M7.5 4.5 4 8l3.5 3.5M16.5 4.5 20 8l-3.5 3.5M14.5 3 9.5 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 17.5h14M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `,
  })

  const shell = document.createElement('section')
  shell.className = 'lml-shell'

  const intro = document.createElement('p')
  intro.className = 'lml-intro'
  intro.textContent =
    'Paste a prompt, resolve it against the active chat, and inspect the result. Input and output live only in this page session; no extension storage is used.'

  const inputCard = document.createElement('section')
  inputCard.className = 'lml-card'

  const inputHeading = document.createElement('div')
  inputHeading.className = 'lml-heading-row'

  const inputLabel = document.createElement('h2')
  inputLabel.className = 'lml-label'
  inputLabel.textContent = 'Input'

  const shortcutHint = document.createElement('span')
  shortcutHint.className = 'lml-hint'
  shortcutHint.textContent = 'Ctrl/⌘ + Enter to resolve'

  const editor = document.createElement('textarea')
  editor.className = 'lml-editor'
  editor.spellcheck = false
  editor.autocomplete = 'off'
  editor.placeholder = 'Paste Lumiverse macros here…\n\nExample: Hello {{user}}, I am {{char}}.'
  editor.setAttribute('aria-label', 'Macro input')

  const actions = document.createElement('div')
  actions.className = 'lml-actions'

  const resolveButton = document.createElement('button')
  resolveButton.className = 'lml-button lml-button-primary'
  resolveButton.type = 'button'
  resolveButton.textContent = 'Resolve'

  const clearButton = document.createElement('button')
  clearButton.className = 'lml-button'
  clearButton.type = 'button'
  clearButton.textContent = 'Clear'

  const spacer = document.createElement('span')
  spacer.className = 'lml-spacer'

  const characterCount = document.createElement('span')
  characterCount.className = 'lml-hint'
  characterCount.textContent = '0 characters'

  actions.append(resolveButton, clearButton, spacer, characterCount)
  inputHeading.append(inputLabel, shortcutHint)
  inputCard.append(inputHeading, editor, actions)

  const outputCard = document.createElement('section')
  outputCard.className = 'lml-card'

  const outputHeading = document.createElement('div')
  outputHeading.className = 'lml-heading-row'

  const outputLabel = document.createElement('h2')
  outputLabel.className = 'lml-label'
  outputLabel.textContent = 'Resolved output'

  const copyButton = document.createElement('button')
  copyButton.className = 'lml-button'
  copyButton.type = 'button'
  copyButton.textContent = 'Copy'
  copyButton.disabled = true

  const output = document.createElement('pre')
  output.className = 'lml-output'
  output.dataset.empty = 'true'
  output.textContent = 'Resolved output will appear here.'
  output.setAttribute('aria-live', 'polite')

  const diagnosticsLabel = document.createElement('h3')
  diagnosticsLabel.className = 'lml-label'
  diagnosticsLabel.textContent = 'Diagnostics'
  diagnosticsLabel.hidden = true

  const diagnosticsList = document.createElement('ol')
  diagnosticsList.className = 'lml-diagnostics'
  diagnosticsList.hidden = true

  const statusRow = document.createElement('div')
  statusRow.className = 'lml-status-row'

  const status = document.createElement('span')
  status.className = 'lml-status'
  status.dataset.state = 'idle'
  status.textContent = 'Ready. Active chat context is detected when you resolve.'

  statusRow.append(status)
  outputHeading.append(outputLabel, copyButton)
  outputCard.append(
    outputHeading,
    output,
    diagnosticsLabel,
    diagnosticsList,
    statusRow,
  )

  shell.append(intro, inputCard, outputCard)
  tab.root.appendChild(shell)

  let pendingRequestId: string | null = null
  let resolvedText = ''

  const setStatus = (message: string, state: 'idle' | 'working' | 'success' | 'error') => {
    status.textContent = message
    status.dataset.state = state
  }

  const setBusy = (busy: boolean) => {
    resolveButton.disabled = busy
    clearButton.disabled = busy
    editor.readOnly = busy
    resolveButton.textContent = busy ? 'Resolving…' : 'Resolve'
  }

  const resetOutput = () => {
    pendingRequestId = null
    resolvedText = ''
    output.dataset.empty = 'true'
    output.textContent = 'Resolved output will appear here.'
    copyButton.disabled = true
    diagnosticsLabel.hidden = true
    diagnosticsList.hidden = true
    diagnosticsList.replaceChildren()
  }

  const renderDiagnostics = (template: string, diagnostics: MacroDiagnostic[]) => {
    diagnosticsList.replaceChildren()

    if (!diagnostics.length) {
      diagnosticsLabel.hidden = true
      diagnosticsList.hidden = true
      return
    }

    diagnosticsLabel.hidden = false
    diagnosticsList.hidden = false

    for (const diagnostic of diagnostics) {
      const location = lineAndColumn(template, diagnostic.offset)
      const item = document.createElement('li')
      item.textContent = `Line ${location.line}, column ${location.column}: ${diagnostic.message}`
      diagnosticsList.appendChild(item)
    }
  }

  const resolve = () => {
    const template = editor.value

    if (!template.trim()) {
      setStatus('Paste something first, bestie.', 'error')
      editor.focus()
      return
    }

    const requestId = createRequestId()
    pendingRequestId = requestId
    setBusy(true)
    setStatus('Resolving with dry-run mode…', 'working')

    ctx.sendToBackend({
      type: 'lumi_macro_lab:resolve',
      requestId,
      template,
    })
  }

  const onResolveClick = () => resolve()

  const onClearClick = () => {
    editor.value = ''
    characterCount.textContent = '0 characters'
    resetOutput()
    setBusy(false)
    setStatus('Cleared. Nothing was saved.', 'idle')
    editor.focus()
  }

  const onEditorInput = () => {
    const count = editor.value.length
    characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? 'character' : 'characters'}`
  }

  const onEditorKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      resolve()
    }
  }

  const onCopyClick = async () => {
    if (!resolvedText) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resolvedText)
      } else if (!copyTextFallback(resolvedText)) {
        throw new Error('Clipboard copy was rejected')
      }

      copyButton.textContent = 'Copied'
      setTimeout(() => {
        copyButton.textContent = 'Copy'
      }, 1200)
    } catch {
      setStatus('Could not copy automatically. Select the output and copy it manually.', 'error')
    }
  }

  resolveButton.addEventListener('click', onResolveClick)
  clearButton.addEventListener('click', onClearClick)
  editor.addEventListener('input', onEditorInput)
  editor.addEventListener('keydown', onEditorKeydown)
  copyButton.addEventListener('click', onCopyClick)

  const unsubscribeBackend = ctx.onBackendMessage((payload: BackendPayload) => {
    if (!payload || typeof payload !== 'object') return

    if (payload.type === 'lumi_macro_lab:result') {
      const result = payload as ResolveResult
      if (result.requestId !== pendingRequestId) return

      pendingRequestId = null
      setBusy(false)
      resolvedText = result.text
      output.dataset.empty = 'false'
      output.textContent = result.text
      copyButton.disabled = result.text.length === 0
      renderDiagnostics(editor.value, Array.isArray(result.diagnostics) ? result.diagnostics : [])

      const contextMessage = result.context
        ? `Resolved using “${result.context.name}”${result.context.hasCharacter ? '' : ' (no character attached)'}.`
        : 'Resolved without an active chat; only context-free macros were available.'
      const diagnosticMessage = result.diagnostics.length
        ? ` ${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? '' : 's'} found.`
        : ' No diagnostics.'

      setStatus(`${contextMessage}${diagnosticMessage}`, 'success')
      return
    }

    if (payload.type === 'lumi_macro_lab:error') {
      const failure = payload as ResolveError
      if (failure.requestId !== pendingRequestId) return

      pendingRequestId = null
      setBusy(false)
      setStatus(`Resolve failed: ${failure.error}`, 'error')
    }
  })

  return () => {
    unsubscribeBackend()
    resolveButton.removeEventListener('click', onResolveClick)
    clearButton.removeEventListener('click', onClearClick)
    editor.removeEventListener('input', onEditorInput)
    editor.removeEventListener('keydown', onEditorKeydown)
    copyButton.removeEventListener('click', onCopyClick)
    tab.destroy()
    removeStyle()
  }
}
