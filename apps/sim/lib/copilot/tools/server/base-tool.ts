export interface BaseServerTool<TArgs = any, TResult = any> {
  name: string
  execute(args: TArgs): Promise<TResult>
}
