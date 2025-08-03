import { createLogger } from '@/lib/logs/console/logger'

// Base tool response interface
export interface CopilotToolResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

// Base tool interface that all copilot tools must implement
export interface CopilotTool<TParams = any, TResult = any> {
  readonly id: string
  readonly displayName: string
  readonly requiresInterrupt: boolean
  execute(params: TParams): Promise<CopilotToolResponse<TResult>>
}

// Abstract base class for copilot tools
export abstract class BaseCopilotTool<TParams = any, TResult = any>
  implements CopilotTool<TParams, TResult>
{
  abstract readonly id: string
  abstract readonly displayName: string
  readonly requiresInterrupt: boolean = false

  private _logger?: ReturnType<typeof createLogger>

  protected get logger() {
    if (!this._logger) {
      this._logger = createLogger(`CopilotTool:${this.id}`)
    }
    return this._logger
  }

  /**
   * Execute the tool with error handling
   */
  async execute(params: TParams): Promise<CopilotToolResponse<TResult>> {
    const startTime = Date.now()

    try {
      this.logger.info(`Executing tool: ${this.id}`, {
        toolId: this.id,
        paramsKeys: Object.keys(params || {}),
      })

      // Execute the tool logic
      const result = await this.executeImpl(params)

      const duration = Date.now() - startTime
      this.logger.info(`Tool execution completed: ${this.id}`, {
        toolId: this.id,
        duration,
        hasResult: !!result,
      })

      return {
        success: true,
        data: result,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      this.logger.error(`Tool execution failed: ${this.id}`, {
        toolId: this.id,
        duration,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      })

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Abstract method that each tool must implement with their specific logic
   */
  protected abstract executeImpl(params: TParams): Promise<TResult>
}
