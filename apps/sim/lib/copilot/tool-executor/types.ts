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
  /**
   * True only for genuine interactive chat turns (which always have a persisted
   * `copilot_chats` row). Undefined/false for headless runs (e.g. Mothership
   * block execution) whose `chatId` is ephemeral and not persisted. Gates
   * chat-scoped `outputs/` writes, which carry a `chat_id` FK to `copilot_chats`.
   */
  interactive?: boolean
  /**
   * The invoking subagent's channel id (its outer tool_use id), threaded per
   * tool call so server tools can scope state to one subagent invocation. Two
   * concurrent file subagents share currentAgentId ("file") but have distinct
   * parentToolCallIds, so this — not currentAgentId — disambiguates them.
   */
  parentToolCallId?: string
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
