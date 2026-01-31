import type { WorkflowsDeleteParams, WorkflowsDeleteResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

export const workflowsDeleteTool: ToolConfig<WorkflowsDeleteParams, WorkflowsDeleteResponse> = {
  id: 'incidentio_workflows_delete',
  name: 'incident.io Workflows Delete',
  description: 'Delete a workflow in incident.io.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the workflow to delete (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/workflows/${params.id}`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: {
        message: 'Workflow deleted successfully',
      },
    }
  },

  outputs: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
}
