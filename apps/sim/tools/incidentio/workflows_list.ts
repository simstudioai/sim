import type { WorkflowsListParams, WorkflowsListResponse } from '@/tools/incidentio/types'
import { INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES } from '@/tools/incidentio/types'
import { mapIncidentioWorkflow } from '@/tools/incidentio/utils'
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
  },

  request: {
    url: 'https://api.incident.io/v2/workflows',
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
        workflows:
          data.workflows?.map((workflow: Record<string, unknown>) =>
            mapIncidentioWorkflow(workflow)
          ) ?? [],
      },
    }
  },

  outputs: {
    workflows: {
      type: 'array',
      description: 'List of workflows',
      items: {
        type: 'object',
        properties: INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES,
      },
    },
  },
}
