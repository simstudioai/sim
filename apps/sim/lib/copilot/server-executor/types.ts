/**
 * Type definitions for the server executor.
 *
 * This provides a clean, type-safe interface for tool execution
 * without any 'any' types.
 */

import type { z } from 'zod'

/**
 * Standard result type for all tool executions.
 * This is the contract between server executors and the chat route.
 */
export interface ToolResult<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Context passed to tool executors.
 */
export interface ExecutionContext {
  userId: string
  workflowId?: string
  chatId?: string
}

/**
 * Configuration for a registered tool.
 * This defines how a tool should be validated and executed.
 */
export interface ToolConfig<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  /** The canonical name of the tool */
  name: string

  /** Zod schema for validating input args (optional - if not provided, args pass through) */
  inputSchema?: TInputSchema

  /** Zod schema for validating output (optional - if not provided, output passes through) */
  outputSchema?: TOutputSchema

  /** Whether context (userId) is required for this tool */
  requiresAuth?: boolean

  /**
   * The execute function.
   * Takes validated args and context, returns result data.
   */
  execute: (
    args: TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown,
    context: ExecutionContext
  ) => Promise<TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown>
}

/**
 * Type for a tool executor function (after wrapping).
 */
export type ToolExecutor = (args: unknown, context: ExecutionContext) => Promise<ToolResult>

/**
 * Helper to create a success result.
 */
export function successResult<T>(data: T): ToolResult<T> {
  return { success: true, data }
}

/**
 * Helper to create an error result.
 */
export function errorResult(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ToolResult {
  return {
    success: false,
    error: { code, message, details },
  }
}
