import type { WorkflowToolExecutionContext } from '@/tools/types'

/**
 * Params accepted by the `managed_agent_run_session` tool. Values come
 * from the Managed Agent workflow block's subblocks; the executor
 * injects `_context` (workspaceId / userId / workflowId) at runtime.
 */
export interface ManagedAgentRunSessionParams {
  /** ID of the `managed_agent_connection` row that stores the API key. */
  connection: string
  /** Managed-agent id from the linked Claude workspace. */
  agent: string
  /** Environment id from the linked Claude workspace. */
  environment: string
  /**
   * Env `config.type` — set by the block's environment combobox
   * `onChange`; used here to route memoryStoreId / sessionParameters
   * correctly at session-create time.
   */
  environmentType?: 'cloud' | 'self_hosted' | string
  /** Zero or more vault ids for MCP auth. Empty array allowed. */
  vaults?: string[]
  /**
   * Workflow-author acknowledgement that they are authorized to use the
   * attached vaults ("I own or am authorized to use these vaults; I
   * understand this means this agent can assume the identity granted by
   * them"). Required to be `true` when `vaults` is non-empty. Enforced by
   * the tool at execution time, not at the block subblock level, because
   * the subblock condition engine cannot natively test array-non-empty.
   */
  vaultsAck?: boolean | string
  /** Optional Agent Memory Store id. */
  memoryStoreId?: string
  /**
   * Access mode for the attached memory store. `read_write` (default)
   * pushes changes back on session exit; `read_only` never writes.
   * Ignored when `memoryStoreId` is empty.
   */
  memoryAccess?: 'read_write' | 'read_only' | string
  /**
   * File attachments (cloud envs only). Each row = `{fileId,
   * mountPath?}`. Ignored for self-hosted envs.
   */
  files?: Array<{ fileId: string; mountPath?: string }>
  /**
   * Key/value session metadata forwarded to the session's top-level
   * `metadata` field. On self-hosted envs the self-hosted agent sandbox
   * exposes each key as an env var; on cloud envs metadata is stored
   * as opaque tags. Each value has already been variable-resolved by
   * the executor.
   */
  sessionParameters?: Record<string, string>
  /** The user's turn as plain text. Resolved by the executor. */
  userMessage: string
  /** Injected by the executor. */
  _context?: WorkflowToolExecutionContext
}

export interface ManagedAgentRunSessionOutput {
  /** Final assistant text accumulated from `agent.message` events. */
  content: string
  /** Anthropic session id (returned so downstream blocks can log/link it). */
  sessionId: string
}
