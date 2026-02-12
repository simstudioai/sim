import { asRecord } from '@/lib/copilot/orchestrator/sse-utils'
import { humanizedFallback, resolveToolDisplay } from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotToolCall } from '@/stores/panel/copilot/types'

export function mapServerStateToClientState(state: unknown): ClientToolCallState {
  switch (String(state || '')) {
    case 'generating':
      return ClientToolCallState.generating
    case 'pending':
    case 'awaiting_approval':
      return ClientToolCallState.pending
    case 'executing':
      return ClientToolCallState.executing
    case 'success':
      return ClientToolCallState.success
    case 'rejected':
    case 'skipped':
      return ClientToolCallState.rejected
    case 'aborted':
      return ClientToolCallState.aborted
    case 'error':
    case 'failed':
      return ClientToolCallState.error
    default:
      return ClientToolCallState.pending
  }
}

export function extractToolUiMetadata(
  data: Record<string, unknown>
): CopilotToolCall['ui'] | undefined {
  const ui = asRecord(data.ui)
  if (!ui || Object.keys(ui).length === 0) return undefined
  const autoAllowedFromUi = ui.autoAllowed === true
  const autoAllowedFromData = data.autoAllowed === true
  return {
    title: typeof ui.title === 'string' ? ui.title : undefined,
    phaseLabel: typeof ui.phaseLabel === 'string' ? ui.phaseLabel : undefined,
    icon: typeof ui.icon === 'string' ? ui.icon : undefined,
    showInterrupt: ui.showInterrupt === true,
    showRemember: ui.showRemember === true,
    autoAllowed: autoAllowedFromUi || autoAllowedFromData,
    actions: Array.isArray(ui.actions)
      ? ui.actions
          .map((action) => {
            const a = asRecord(action)
            const id = typeof a.id === 'string' ? a.id : undefined
            const label = typeof a.label === 'string' ? a.label : undefined
            const kind: 'accept' | 'reject' = a.kind === 'reject' ? 'reject' : 'accept'
            if (!id || !label) return null
            return {
              id,
              label,
              kind,
              remember: a.remember === true,
            }
          })
          .filter((a): a is NonNullable<typeof a> => !!a)
      : undefined,
  }
}

export function extractToolExecutionMetadata(
  data: Record<string, unknown>
): CopilotToolCall['execution'] | undefined {
  const execution = asRecord(data.execution)
  if (!execution || Object.keys(execution).length === 0) return undefined
  return {
    target: typeof execution.target === 'string' ? execution.target : undefined,
    capabilityId: typeof execution.capabilityId === 'string' ? execution.capabilityId : undefined,
  }
}

function displayVerb(state: ClientToolCallState): string {
  switch (state) {
    case ClientToolCallState.success:
      return 'Completed'
    case ClientToolCallState.error:
      return 'Failed'
    case ClientToolCallState.rejected:
      return 'Skipped'
    case ClientToolCallState.aborted:
      return 'Aborted'
    case ClientToolCallState.generating:
      return 'Preparing'
    case ClientToolCallState.pending:
      return 'Waiting'
    default:
      return 'Running'
  }
}

export function resolveDisplayFromServerUi(
  toolName: string,
  state: ClientToolCallState,
  toolCallId: string,
  params: Record<string, unknown> | undefined,
  ui?: CopilotToolCall['ui']
) {
  const fallback =
    resolveToolDisplay(toolName, state, toolCallId, params) ||
    humanizedFallback(toolName, state)
  if (!fallback) return undefined
  if (ui?.phaseLabel) {
    return { text: ui.phaseLabel, icon: fallback.icon }
  }
  if (ui?.title) {
    return { text: `${displayVerb(state)} ${ui.title}`, icon: fallback.icon }
  }
  return fallback
}

export function isWorkflowChangeApplyCall(
  toolName?: string,
  params?: Record<string, unknown>
): boolean {
  if (toolName !== 'workflow_change') return false
  const mode = typeof params?.mode === 'string' ? params.mode.toLowerCase() : ''
  if (mode === 'apply') return true
  return typeof params?.proposalId === 'string' && params.proposalId.length > 0
}

export function extractOperationListFromResultPayload(
  resultPayload: Record<string, unknown>
): Array<Record<string, unknown>> | undefined {
  const operations = resultPayload.operations
  if (Array.isArray(operations)) return operations as Array<Record<string, unknown>>

  const compiled = resultPayload.compiledOperations
  if (Array.isArray(compiled)) return compiled as Array<Record<string, unknown>>

  return undefined
}
