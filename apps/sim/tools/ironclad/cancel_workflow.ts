import type {
  IroncladCancelWorkflowParams,
  IroncladCancelWorkflowResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const cancelWorkflowTool: ToolConfig<
  IroncladCancelWorkflowParams,
  IroncladCancelWorkflowResponse
> = {
  id: 'ironclad_cancel_workflow',
  name: 'Ironclad Cancel Workflow',
  description: 'Cancel a workflow instance by its ID.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ironclad',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    ironcladWorkflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the workflow to cancel',
    },
  },

  request: {
    url: (params) =>
      `https://na1.ironcladapp.com/public/api/v1/workflows/${params.ironcladWorkflowId.trim()}/cancel`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(
        (data as Record<string, string>).message ||
          (data as Record<string, string>).error ||
          'Failed to cancel workflow'
      )
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the cancellation was successful' },
  },
}
