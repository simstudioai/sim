import { BaseCopilotTool } from '../base'

// No parameters interface - empty object
interface NoOpParams {}

interface NoOpResult {
  message: string
  status: string
}

class NoOpTool extends BaseCopilotTool<NoOpParams, NoOpResult> {
  readonly id = 'no_op'
  readonly displayName = 'No operation (requires confirmation)'
  readonly requiresInterrupt = true

  protected async executeImpl(params: NoOpParams): Promise<NoOpResult> {
    return {
      message: 'No-op tool executed successfully',
      status: 'success'
    }
  }
}

// Export the tool instance
export const noOpTool = new NoOpTool() 