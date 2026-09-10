import type { DecisionDescriptor } from '../core/decision-graph.js'
import type { DecisionState } from '../core/state.js'

export type MacroDiagnostic = {
  message: string
  offset: number
  length: number
}

export type VariableScope = 'local' | 'chat' | 'global'

export type VariableSnapshot = {
  chat: Record<string, string>
  local: Record<string, string>
  global: Record<string, string>
}

export type MacroDefinition = {
  name: string
  description: string
  body: string
  createdAt: string
  updatedAt: string
}

export type MacroDefinitionView = MacroDefinition & {
  fingerprint: string
  decisions: DecisionDescriptor[]
}

export type ResolveRequest = {
  type: 'macrolab:resolve'
  requestId: string
  template: string
}

export type GetStateRequest = {
  type: 'macrolab:get_state'
  requestId: string
}

export type SaveMacroRequest = {
  type: 'macrolab:save_macro'
  requestId: string
  originalName?: string
  definition: {
    name: string
    description?: string
    body: string
  }
}

export type DeleteMacroRequest = {
  type: 'macrolab:delete_macro'
  requestId: string
  name: string
}

export type DecisionAction = 'reroll' | 'toggle_lock' | 'reset' | 'undo'

export type DecisionActionRequest = {
  type: 'macrolab:decision_action'
  requestId: string
  key: string
  action: DecisionAction
}

export type InstanceActionRequest = {
  type: 'macrolab:instance_action'
  requestId: string
  macroName: string
  instance: string
  action: 'reroll' | 'reset'
}

export type VariableActionRequest = {
  type: 'macrolab:variable_action'
  requestId: string
  scope: VariableScope
  action: 'set' | 'delete'
  key: string
  value?: string
}

export type FrontendRequest =
  | ResolveRequest
  | GetStateRequest
  | SaveMacroRequest
  | DeleteMacroRequest
  | DecisionActionRequest
  | InstanceActionRequest
  | VariableActionRequest

export type ResolveResult = {
  type: 'macrolab:result'
  requestId: string
  text: string
  diagnostics: MacroDiagnostic[]
  context: null | {
    id: string
    name: string
    hasCharacter: boolean
    variables: VariableSnapshot
  }
}

export type StateResult = {
  type: 'macrolab:state'
  requestId: string
  notice: string
  macros: MacroDefinitionView[]
  decisions: Array<{ key: string; state: DecisionState }>
  variables: VariableSnapshot
  context: null | {
    id: string
    name: string
    hasCharacter: boolean
  }
}

export type BackendError = {
  type: 'macrolab:error'
  requestId: string
  error: string
}

export type BackendPayload = ResolveResult | StateResult | BackendError | Record<string, unknown>
