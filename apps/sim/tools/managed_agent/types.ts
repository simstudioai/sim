import type { ToolResponse } from '@/tools/types'

/**
 * Params accepted by the `managed_agent_run_session` tool. Values come from
 * the Managed Agent block's subblocks in their raw runtime shapes; the tool's
 * `directExecution` normalizes them before running the session. `accessToken`
 * is injected by the executor from the selected `credential`.
 */
export interface ManagedAgentRunSessionParams {
  /** Claude Platform service-account credential id (block picker value). */
  credential: string
  /** Workspace API key injected by the executor from `credential` at run time. */
  accessToken?: string
  /** Managed-agent id from the linked Claude workspace. */
  agent: string
  /** Environment id from the linked Claude workspace. */
  environment: string
  /** Env-type hint ('cloud' | 'self_hosted') from the block; re-resolved server-side. */
  environmentType?: string
  /** The user's turn as plain text. Resolved by the executor. */
  userMessage: string
  /** Zero or more vault ids for MCP auth (array, json string, or comma-list). */
  vaults?: unknown
  /** Acknowledgement that the author may use the attached vaults. */
  vaultsAck?: boolean | string
  /** Optional Agent Memory Store id. */
  memoryStoreId?: string
  /** Memory store access mode — `read_write` (default) or `read_only`. */
  memoryAccess?: string
  /** Per-attachment guidance for how the agent should use the memory store. */
  memoryInstructions?: string
  /** Files-API files (cloud environments), as table rows, an array, or a comma list. */
  files?: unknown
  /** Key/value session metadata, as table rows or a flat object. */
  sessionParameters?: unknown
  /** Execution context injected by the executor (used to title the session for traceability). */
  _context?: { workflowId?: string }
}

export interface ManagedAgentRunSessionResponse extends ToolResponse {
  output: {
    /** Final assistant text from the Managed Agent session. */
    content: string
    /** Anthropic session id (for logs / linking). */
    sessionId: string
    /** Cumulative input tokens for the session, when available. */
    inputTokens?: number
    /** Cumulative output tokens for the session, when available. */
    outputTokens?: number
  }
}
