import type { MothershipResource } from '@/lib/copilot/resources/types'

export interface ToolExecutionContext {
  userId: string
  workflowId: string
  workspaceId?: string
  chatId?: string
  messageId?: string
  executionId?: string
  runId?: string
  copilotToolExecution?: boolean
  requestMode?: string
  currentAgentId?: string
  abortSignal?: AbortSignal
  userTimezone?: string
  userPermission?: string
  decryptedEnvVars?: Record<string, string>
}

export interface ToolExecutionResult {
  success: boolean
  output?: unknown
  error?: string
  resources?: MothershipResource[]
}

export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>

export interface ToolCallDescriptor {
  toolCallId: string
  toolId: string
  params: Record<string, unknown>
}
