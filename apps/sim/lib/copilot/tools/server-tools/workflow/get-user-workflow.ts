import { createLogger } from '@/lib/logs/console/logger'
import { BaseCopilotTool } from '../base'

interface GetUserWorkflowParams {
  workflowId?: string
  includeMetadata?: boolean
  confirmationMessage?: string
  fullData?: any
}

class GetUserWorkflowTool extends BaseCopilotTool<GetUserWorkflowParams, string> {
  readonly id = 'get_user_workflow'
  readonly displayName = 'Analyzing your workflow'
  readonly requiresInterrupt = true // This triggers automatic Redis polling

  protected async executeImpl(params: GetUserWorkflowParams): Promise<string> {
    const logger = createLogger('GetUserWorkflow')

    logger.info('Server tool received params', {
      hasFullData: !!params.fullData,
      hasConfirmationMessage: !!params.confirmationMessage,
      fullDataType: typeof params.fullData,
      fullDataKeys: params.fullData ? Object.keys(params.fullData) : null,
      confirmationMessageLength: params.confirmationMessage?.length || 0,
    })

    // Extract the workflow data from fullData or confirmationMessage
    let workflowData: string | null = null

    if (params.fullData?.userWorkflow) {
      // New format: fullData contains structured data with userWorkflow field
      workflowData = params.fullData.userWorkflow
      logger.info('Using workflow data from fullData.userWorkflow', {
        dataLength: workflowData?.length || 0,
      })
    } else if (params.confirmationMessage) {
      // The confirmationMessage might contain the structured JSON data
      logger.info('Attempting to parse confirmationMessage as structured data', {
        messageLength: params.confirmationMessage.length,
        messagePreview: params.confirmationMessage.substring(0, 100),
      })

      try {
        // Try to parse the confirmation message as structured data
        const parsedMessage = JSON.parse(params.confirmationMessage)
        if (parsedMessage?.userWorkflow) {
          workflowData = parsedMessage.userWorkflow
          logger.info('Successfully extracted userWorkflow from confirmationMessage', {
            dataLength: workflowData?.length || 0,
          })
        } else {
          // Fallback: treat the entire message as workflow data
          workflowData = params.confirmationMessage
          logger.info('Using confirmationMessage directly as workflow data', {
            dataLength: workflowData.length,
          })
        }
      } catch (parseError) {
        // If parsing fails, use the message directly
        workflowData = params.confirmationMessage
        logger.info('Failed to parse confirmationMessage, using directly', {
          dataLength: workflowData.length,
          parseError: parseError instanceof Error ? parseError.message : 'Unknown error',
        })
      }
    } else {
      throw new Error('No workflow data received from client tool')
    }

    if (!workflowData) {
      throw new Error('No workflow data available')
    }

    try {
      // Parse the workflow data to validate it's valid JSON
      const workflowState = JSON.parse(workflowData)

      if (!workflowState || !workflowState.blocks) {
        throw new Error('Invalid workflow state received from client tool')
      }

      logger.info('Successfully parsed and validated workflow data', {
        blockCount: Object.keys(workflowState.blocks).length,
      })

      // Return the workflow data as properly formatted JSON string
      return JSON.stringify(workflowState, null, 2)
    } catch (error) {
      logger.error('Failed to parse workflow data from client tool', { error })
      throw new Error('Invalid workflow data format received from client tool')
    }
  }
}

// Export the tool instance
export const getUserWorkflowTool = new GetUserWorkflowTool()
