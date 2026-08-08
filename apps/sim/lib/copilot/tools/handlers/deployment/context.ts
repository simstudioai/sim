import type { ToolExecutionContext } from '@/lib/copilot/tool-executor/types'

type DeploymentToolContext = Pick<
  ToolExecutionContext,
  'executionId' | 'messageId' | 'runId' | 'toolCallId'
>

interface DeploymentAttemptCurrentState {
  isCurrent?: boolean
}

/**
 * Builds a retry-stable scope for one deployment intent in a Copilot run.
 * The orchestration layer appends the canonical deployment request hash, so
 * an unchanged retry reuses the operation while a later edited draft remains
 * a distinct deployment.
 */
export function getCopilotDeploymentIdempotencyKey(
  context: DeploymentToolContext,
  operation: string
): string | undefined {
  const executionScope = context.executionId ?? context.runId ?? context.messageId
  if (executionScope) return `copilot:${executionScope}:operation:${operation}`
  return context.toolCallId
    ? `copilot:tool-call:${context.toolCallId}:operation:${operation}`
    : undefined
}

/** Rejects a replay whose persisted operation no longer describes production. */
export function getHistoricalDeploymentAttemptError(
  attempt: DeploymentAttemptCurrentState | null | undefined,
  action: string
): string | null {
  if (attempt?.isCurrent !== false) return null
  return `The ${action} operation associated with this tool call is historical and no longer describes production. Start a new tool call to create a new logical deployment operation.`
}
