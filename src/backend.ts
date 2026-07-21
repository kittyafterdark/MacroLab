declare const spindle: any

type ResolveRequest = {
  type: 'lumi_macro_lab:resolve'
  requestId: string
  template: string
}

type MacroDiagnostic = {
  message: string
  offset: number
  length: number
}

const MAX_TEMPLATE_LENGTH = 500_000

function isResolveRequest(payload: unknown): payload is ResolveRequest {
  if (!payload || typeof payload !== 'object') return false

  const candidate = payload as Partial<ResolveRequest>
  return (
    candidate.type === 'lumi_macro_lab:resolve' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.template === 'string'
  )
}

spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
  if (!isResolveRequest(payload)) return

  const { requestId, template } = payload

  try {
    if (template.length > MAX_TEMPLATE_LENGTH) {
      throw new Error(
        `Input is too large (${template.length.toLocaleString()} characters). The preview limit is ${MAX_TEMPLATE_LENGTH.toLocaleString()} characters.`,
      )
    }

    const activeChat = await spindle.chats.getActive()
    const options: {
      chatId?: string
      characterId?: string
      userId: string
      commit: false
    } = { userId, commit: false }

    if (activeChat?.id) options.chatId = activeChat.id
    if (activeChat?.character_id) options.characterId = activeChat.character_id

    const result = await spindle.macros.resolve(template, options)
    const diagnostics: MacroDiagnostic[] = Array.isArray(result?.diagnostics)
      ? result.diagnostics
      : []

    spindle.sendToFrontend(
      {
        type: 'lumi_macro_lab:result',
        requestId,
        text: typeof result?.text === 'string' ? result.text : '',
        diagnostics,
        context: activeChat
          ? {
              name:
                typeof activeChat.name === 'string' && activeChat.name.trim()
                  ? activeChat.name
                  : 'Active chat',
              hasCharacter: Boolean(activeChat.character_id),
            }
          : null,
      },
      userId,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)

    spindle.sendToFrontend(
      {
        type: 'lumi_macro_lab:error',
        requestId,
        error: message,
      },
      userId,
    )
  }
})

spindle.log.info('Lumi Macro Lab loaded')
