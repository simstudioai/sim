import type { z } from 'zod'

export interface ServerToolContext {
  userId: string
  workspaceId?: string
  userPermission?: string
  chatId?: string
  messageId?: string
  /**
   * The invoking subagent's channel id (its outer tool_use id). Used to scope
   * the workspace_file -> edit_content intent handoff to a single file subagent
   * so two file agents writing concurrently never consume each other's pending
   * intent. Undefined for main-agent tool calls (which never overlap).
   */
  parentToolCallId?: string
  abortSignal?: AbortSignal
  /** Fires only on explicit user stop, never on passive transport disconnect. */
  userStopSignal?: AbortSignal
}

export function assertServerToolNotAborted(
  context?: ServerToolContext,
  message = 'Request aborted before tool mutation could be applied.'
): void {
  if (context?.userStopSignal?.aborted) {
    const reason = context.userStopSignal.reason
      ? ` (reason: ${String(context.userStopSignal.reason)})`
      : ''
    throw new Error(`${message}${reason}`)
  }
}

/**
 * Base interface for server-side copilot tools.
 *
 * Tools can optionally declare Zod schemas for input/output validation.
 * If provided, the router validates automatically.
 */
export interface BaseServerTool<TArgs = unknown, TResult = unknown> {
  name: string
  execute(args: TArgs, context?: ServerToolContext): Promise<TResult>
  /** Optional Zod schema for input validation */
  inputSchema?: z.ZodType<TArgs>
  /** Optional Zod schema for output validation */
  outputSchema?: z.ZodType<TResult>
}
