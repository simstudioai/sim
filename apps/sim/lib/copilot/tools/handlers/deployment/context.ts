import type { ToolExecutionContext } from '@/lib/copilot/tool-executor/types'

type DeploymentToolContext = Pick<
  ToolExecutionContext,
  'executionId' | 'messageId' | 'runId' | 'toolCallId'
>

interface DeploymentAttemptCurrentState {
  isCurrent?: boolean
}

/**
 * Builds a replay-stable idempotency key for one logical Copilot tool call.
 * The orchestration layer generates a fresh key when legacy callers do not
 * provide a tool-call identity.
 */
export function getCopilotDeploymentIdempotencyKey(
  context: DeploymentToolContext
): string | undefined {
  if (!context.toolCallId) return undefined

  const executionScope = context.executionId ?? context.runId ?? context.messageId
  return executionScope
    ? `copilot:${executionScope}:tool-call:${context.toolCallId}`
    : `copilot:tool-call:${context.toolCallId}`
}

/** Rejects a replay whose persisted operation no longer describes production. */
export function getHistoricalDeploymentAttemptError(
  attempt: DeploymentAttemptCurrentState | null | undefined,
  action: string
): string | null {
  if (attempt?.isCurrent !== false) return null
  return `The ${action} operation associated with this tool call is historical and no longer describes production. Start a new tool call to create a new logical deployment operation.`
}
