/**
 * Base interface for server-executed tools.
 *
 * @template TArgs - The type of arguments the tool accepts
 * @template TResult - The type of result the tool returns
 */
export interface BaseServerTool<TArgs = unknown, TResult = unknown> {
  /** The canonical name of the tool (must match the registry key) */
  name: string
  /** Execute the tool with the given arguments and context */
  execute(args: TArgs, context?: { userId: string }): Promise<TResult>
}
