import type { WorkflowsShowParams, WorkflowsShowResponse } from '@/tools/incidentio/types'
import { INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES } from '@/tools/incidentio/types'
import { mapIncidentioWorkflow } from '@/tools/incidentio/utils'
import type { ToolConfig } from '@/tools/types'

export const workflowsShowTool: ToolConfig<WorkflowsShowParams, WorkflowsShowResponse> = {
  id: 'incidentio_workflows_show',
  name: 'incident.io Workflows Show',
  description: 'Get details of a specific workflow in incident.io.',
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
      description: 'The ID of the workflow to retrieve (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    skip_step_upgrades: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip workflow step upgrades when existing workflow step parameters changed',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.incident.io/v2/workflows/${params.id.trim()}`)
      if (params.skip_step_upgrades !== undefined) {
        url.searchParams.set('skip_step_upgrades', String(params.skip_step_upgrades))
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
        management_meta: data.management_meta,
        workflow: mapIncidentioWorkflow(data.workflow),
      },
    }
  },

  outputs: {
    workflow: {
      type: 'object',
      description: 'The workflow details',
      properties: INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES,
    },
    management_meta: {
      type: 'json',
      description: 'Workflow management metadata',
      optional: true,
    },
  },
}
