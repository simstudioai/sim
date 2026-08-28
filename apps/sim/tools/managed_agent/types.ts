import type { ToolResponse } from '@/tools/types'

/**
 * Params accepted by the `managed_agent_run_session` tool. Values come from
 * the Managed Agent block's subblocks in their raw runtime shapes; the internal
 * operation normalizes them before running the session. `accessToken` is injected
 * by the executor from the selected `credential`.
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

/** Shape shared by the session-operation tools' params. */
interface ManagedAgentSessionOpParams {
  credential: string
  accessToken?: string
  sessionId?: string
}

export interface ManagedAgentCreateSessionParams
  extends Omit<ManagedAgentRunSessionParams, 'userMessage'> {
  /** Optional first turn, seeded via `initial_events` so create+send is one call. */
  userMessage?: string
}

export interface ManagedAgentCreateSessionResponse extends ToolResponse {
  output: {
    sessionId: string
    /** True when a first message was seeded and the agent loop already started. */
    started: boolean
  }
}

export interface ManagedAgentSendMessageParams extends ManagedAgentSessionOpParams {
  userMessage: string
}

export interface ManagedAgentSendMessageResponse extends ToolResponse {
  output: { sessionId: string; sent: boolean }
}

export interface ManagedAgentGetSessionParams extends ManagedAgentSessionOpParams {}

/** One tool call blocking a session. */
export interface ManagedAgentPendingTool {
  id: string
  eventType?: string
  /**
   * Which operation unblocks this gate: `confirmation` (Respond To Tool
   * Confirmation) or `custom_tool_result` (Respond To Custom Tool).
   */
  kind?: 'confirmation' | 'custom_tool_result'
  name?: string
  input?: unknown
}

export interface ManagedAgentGetSessionResponse extends ToolResponse {
  output: {
    sessionId: string
    status: string
    /** `stop_reason.type` from the session, when it has stopped at least once. */
    stopReason?: string
    /** True when the session is parked awaiting a tool confirmation or result. */
    requiresAction: boolean
    /** Blocking tool calls, resolved to names where possible. Empty unless `requiresAction`. */
    pendingTools: ManagedAgentPendingTool[]
    metadata?: Record<string, string>
    title?: string
    inputTokens?: number
    outputTokens?: number
  }
}

export interface ManagedAgentListEventsParams extends ManagedAgentSessionOpParams {
  /** Optional `types[]` filter (array, JSON string, or comma list). */
  eventTypes?: unknown
  /** Cap on events returned; guards against an unbounded history read. */
  limit?: unknown
}

export interface ManagedAgentListEventsResponse extends ToolResponse {
  output: {
    sessionId: string
    events: unknown[]
    count: number
    /** Concatenated text of every `agent.message`, in order — the usual thing callers want. */
    assistantText: string
    /** True when `limit` was reached and older events were dropped. */
    truncated: boolean
  }
}

export interface ManagedAgentUpdateSessionParams extends ManagedAgentSessionOpParams {
  title?: string
  sessionParameters?: unknown
  /** Explicitly removes all stored metadata; an empty map cannot express this. */
  clearMetadata?: boolean | string
}

export interface ManagedAgentUpdateSessionResponse extends ToolResponse {
  output: { sessionId: string; updated: boolean; metadata?: Record<string, string>; title?: string }
}

export interface ManagedAgentInterruptSessionParams extends ManagedAgentSessionOpParams {}

export interface ManagedAgentInterruptSessionResponse extends ToolResponse {
  output: { sessionId: string; interrupted: boolean }
}

export interface ManagedAgentToolConfirmationParams extends ManagedAgentSessionOpParams {
  /** Blocking tool-use EVENT ids (array, JSON string, or comma list). */
  toolUseIds?: unknown
  /** `allow` or `deny`. */
  decision?: string
  /** Reason surfaced to the agent; only sent on a denial. */
  denyMessage?: string
}

export interface ManagedAgentToolConfirmationResponse extends ToolResponse {
  output: { sessionId: string; decision: string; confirmedToolUseIds: string[] }
}

export interface ManagedAgentCustomToolResultParams extends ManagedAgentSessionOpParams {
  /** The blocking custom tool-use EVENT id being answered. */
  customToolUseId?: string
  /** The tool's output, returned to the agent. */
  result?: string
  /** Marks the result as a failure. */
  isError?: boolean | string
}

export interface ManagedAgentCustomToolResultResponse extends ToolResponse {
  output: { sessionId: string; answeredToolUseId: string }
}

export interface ManagedAgentArchiveSessionParams extends ManagedAgentSessionOpParams {}

export interface ManagedAgentArchiveSessionResponse extends ToolResponse {
  output: { sessionId: string; archived: boolean }
}

export interface ManagedAgentDeleteSessionParams extends ManagedAgentSessionOpParams {}

export interface ManagedAgentDeleteSessionResponse extends ToolResponse {
  output: { sessionId: string; deleted: boolean }
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
