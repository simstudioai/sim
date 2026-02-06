import type { z } from 'zod'

export interface ServerToolContext {
  userId: string
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
