import type { WorkflowsListParams, WorkflowsListResponse } from '@/tools/incidentio/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Number of workflows to return per page (e.g., 10, 25, 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor to fetch the next page of results (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v2/workflows')

      if (params.page_size) {
        url.searchParams.set('page_size', Number(params.page_size).toString())
      }

      if (params.after) {
        url.searchParams.set('after', params.after)
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
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
        pagination_meta: data.pagination_meta
          ? {
              after: data.pagination_meta.after,
              page_size: data.pagination_meta.page_size,
            }
          : undefined,
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
    pagination_meta: {
      type: 'object',
      description: 'Pagination metadata',
      optional: true,
      properties: {
        after: { type: 'string', description: 'Cursor for next page', optional: true },
        page_size: { type: 'number', description: 'Number of results per page' },
      },
    },
  },
}
