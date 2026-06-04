import type { z } from 'zod'

export interface ServerToolContext {
  userId: string
  workspaceId?: string
  userPermission?: string
  chatId?: string
  messageId?: string
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
