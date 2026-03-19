import type { McpToolResult } from '@/lib/mcp/types'
import type { McpExecutionContext, McpMiddleware, McpMiddlewareNext } from './types'

export class ResiliencePipeline {
  private middlewares: McpMiddleware[] = []

  /**
   * Add a middleware to the pipeline chain.
   */
  use(middleware: McpMiddleware): this {
    this.middlewares.push(middleware)
    return this
  }

  /**
   * Execute the pipeline, processing the context through all middlewares,
   * and finally invoking the terminal handler.
   */
  async execute(
    context: McpExecutionContext,
    finalHandler: McpMiddlewareNext
  ): Promise<McpToolResult> {
    let index = -1

    const dispatch = async (i: number): Promise<McpToolResult> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      // If we reached the end of the middlewares, call the final handler
      if (i === this.middlewares.length) {
        return finalHandler(context)
      }

      const middleware = this.middlewares[i]
      return middleware.execute(context, () => dispatch(i + 1))
    }

    return dispatch(0)
  }
}
