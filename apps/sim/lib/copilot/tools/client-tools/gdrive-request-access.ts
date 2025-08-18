import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'

export class GDriveRequestAccessTool extends BaseTool {
  static readonly id = 'gdrive_request_access'

  metadata: ToolMetadata = {
    id: GDriveRequestAccessTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Select Google Drive files',
          icon: 'googleDrive',
        },
        executing: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        accepted: {
          displayName: 'Requesting Google Drive access',
          icon: 'spinner',
        },
        success: {
          displayName: 'Selected Google Drive files',
          icon: 'googleDrive',
        },
        rejected: {
          displayName: 'Skipped Google Drive access request',
          icon: 'skip',
        },
        errored: {
          displayName: 'Failed to request Google Drive access',
          icon: 'error',
        },
      },
    },
    schema: {
      name: GDriveRequestAccessTool.id,
      description: 'Prompt the user to grant Google Drive file access via the picker',
      parameters: {
        type: 'object',
        properties: {
          // Accepts arbitrary context but no required params
        },
        required: [],
      },
    },
    requiresInterrupt: true,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    // Execution is trivial: we only notify the server that the user completed the action.
    // Any data transfer happens via the picker; if needed later, it can be included in the message.
    await this.notify(toolCall.id, 'success', 'User completed Google Drive access picker')
    options?.onStateChange?.('success')

    return {
      success: true,
      data: {
        message: 'Google Drive access confirmed by user',
      },
    }
  }
}
