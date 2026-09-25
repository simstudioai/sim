import { type CurrentBrowserToolName, isCurrentBrowserToolName } from '@sim/browser-protocol'
import { isTerminalToolName } from '@sim/terminal-protocol'
import {
  MothershipStreamV1ToolPhase,
  MothershipStreamV1ToolStatus,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { isNativeFileTool, isUserLocalVfsToolCall } from '@/lib/mothership/tools/local-filesystem'
import { isWorkflowToolName } from '@/lib/mothership/tools/workflow-tools'

export type ToolEvent = Extract<PersistedStreamEventEnvelope, { type: 'tool' }>

interface ClientToolCall {
  toolCallId: string
  args: Record<string, unknown>
  /** The envelope's emission timestamp; executors drop stale replays by it. */
  eventTs?: string
}

/**
 * A tool call the orchestrator hands to this client, by the executor that runs
 * it. The orchestrator blocks until the client reports the call's outcome, so
 * every start must reach its executor.
 */
export type ClientToolStart = ClientToolCall &
  (
    | { kind: 'workflow' | 'localFilesystem' | 'terminal'; toolName: string }
    | { kind: 'browser'; toolName: CurrentBrowserToolName }
  )

/**
 * Resolves the client-executed tool call a stream event asks this client to
 * start, or null when the event starts nothing. Only a complete call frame
 * that is not held behind an approval prompt starts a tool.
 *
 * @param isPending - whether the call is still running without a result, as
 *   far as the caller has seen
 */
export function resolveClientToolStart(
  event: ToolEvent,
  isPending: (toolCallId: string) => boolean
): ClientToolStart | null {
  const payload = event.payload
  if (
    'previewPhase' in payload ||
    payload.phase === MothershipStreamV1ToolPhase.args_delta ||
    payload.phase === MothershipStreamV1ToolPhase.result ||
    payload.partial === true ||
    payload.status === MothershipStreamV1ToolStatus.generating ||
    payload.status === MothershipStreamV1ToolStatus.awaiting_approval
  ) {
    return null
  }

  const { toolCallId, toolName } = payload
  const args = payload.arguments as Record<string, unknown> | undefined
  const call = { toolCallId, args: args ?? {}, eventTs: event.ts }
  let start: ClientToolStart | null = null
  if (isWorkflowToolName(toolName)) {
    start = { ...call, kind: 'workflow', toolName }
  } else if (isNativeFileTool(toolName) || isUserLocalVfsToolCall(toolName, args)) {
    start = { ...call, kind: 'localFilesystem', toolName }
  } else if (isCurrentBrowserToolName(toolName)) {
    start = { ...call, kind: 'browser', toolName }
  } else if (isTerminalToolName(toolName)) {
    start = { ...call, kind: 'terminal', toolName }
  }
  return start && isPending(toolCallId) ? start : null
}
