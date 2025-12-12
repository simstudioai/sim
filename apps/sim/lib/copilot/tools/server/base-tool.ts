export interface BaseServerTool<TArgs = any, TResult = any> {
  name: string
  execute(args: TArgs, context?: { userId: string }): Promise<TResult>
}
