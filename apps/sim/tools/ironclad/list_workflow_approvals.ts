import type {
  IroncladListWorkflowApprovalsParams,
  IroncladListWorkflowApprovalsResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowApprovalsTool: ToolConfig<
  IroncladListWorkflowApprovalsParams,
  IroncladListWorkflowApprovalsResponse
> = {
  id: 'ironclad_list_workflow_approvals',
  name: 'Ironclad List Workflow Approvals',
  description:
    'List all triggered approvals for a specific workflow. Conditional approvals that have not been triggered will not appear.',
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
      description: 'The unique identifier of the workflow',
    },
  },

  request: {
    url: (params) =>
      `https://na1.ironcladapp.com/public/api/v1/workflows/${params.ironcladWorkflowId.trim()}/approvals`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to list workflow approvals')
    }

    return {
      success: true,
      output: {
        approvals: data.approvalGroups ?? data ?? [],
      },
    }
  },

  outputs: {
    approvals: { type: 'json', description: 'List of triggered approval groups for the workflow' },
  },
}
