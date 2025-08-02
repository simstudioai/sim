import { createLogger } from '@/lib/logs/console/logger'
import { BaseCopilotTool } from '../base'

const logger = createLogger('NoOpTool')

// No parameters interface - empty object
interface NoOpParams {
  confirmationMessage?: string
}

interface NoOpResult {
  message: string
  status: string
}

class NoOpTool extends BaseCopilotTool<NoOpParams, NoOpResult> {
  readonly id = 'no_op'
  readonly displayName = 'No operation (requires confirmation)'
  readonly requiresInterrupt = true

  protected async executeImpl(params: NoOpParams): Promise<NoOpResult> {
    const message = params.confirmationMessage
      ? `No-op tool executed successfully. ${params.confirmationMessage}`
      : 'No-op tool executed successfully'

    const result = {
      message,
      status: 'success',
    }

    // Log the noop tool response for debugging
    logger.info('NoOp tool executed', {
      result,
      confirmationMessage: params.confirmationMessage,
      hasConfirmationMessage: !!params.confirmationMessage,
    })

    // Log what we're about to return
    logger.info('NoOp tool returning result', {
      result,
      resultType: typeof result,
      resultKeys: Object.keys(result),
    })

    return result
  }
}

// Export the tool instance
export const noOpTool = new NoOpTool()
