import type { ToolConfig } from '@/tools/types'
import type { WorkflowsListParams, WorkflowsListResponse } from './types'

export const workflowsListTool: ToolConfig<WorkflowsListParams, WorkflowsListResponse> = {
  id: 'incidentio_workflows_list',
  name: 'incident.io Workflows List',
  description: 'List all workflows in your incident.io workspace.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of workflows to return per page',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/workflows',
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    params: (params) => {
      const queryParams: Record<string, any> = {}

      if (params.page_size) {
        queryParams.page_size = Number(params.page_size)
      }

      return queryParams
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        workflows: data.workflows.map((workflow: any) => ({
          id: workflow.id,
          name: workflow.name,
          state: workflow.state,
          folder: workflow.folder,
          created_at: workflow.created_at,
          updated_at: workflow.updated_at,
        })),
      },
    }
  },

  outputs: {
    workflows: {
      type: 'array',
      description: 'List of workflows',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the workflow' },
          name: { type: 'string', description: 'Name of the workflow' },
          state: {
            type: 'string',
            description: 'State of the workflow (active, draft, or disabled)',
          },
          folder: { type: 'string', description: 'Folder the workflow belongs to', optional: true },
          created_at: {
            type: 'string',
            description: 'When the workflow was created',
            optional: true,
          },
          updated_at: {
            type: 'string',
            description: 'When the workflow was last updated',
            optional: true,
          },
        },
      },
    },
  },
}
