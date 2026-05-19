import type { WorkflowsUpdateParams, WorkflowsUpdateResponse } from '@/tools/incidentio/types'
import {
  parseIncidentioJsonParam,
  parseRequiredIncidentioJsonParam,
} from '@/tools/incidentio/utils'
import type { ToolConfig } from '@/tools/types'

export const workflowsUpdateTool: ToolConfig<WorkflowsUpdateParams, WorkflowsUpdateResponse> = {
  id: 'incidentio_workflows_update',
  name: 'incident.io Workflows Update',
  description: 'Update an existing workflow in incident.io.',
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
      description: 'The ID of the workflow to update (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New name for the workflow (e.g., "Notify on Critical Incidents")',
    },
    steps: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete array of workflow steps as a JSON string',
    },
    condition_groups: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete array of workflow condition groups as a JSON string',
    },
    runs_on_incidents: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'When to run the workflow: newly_created, newly_created_and_active, active, or all',
    },
    runs_on_incident_modes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete array of incident modes to run on as a JSON string',
    },
    include_private_incidents: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to include private incidents',
    },
    continue_on_step_error: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to continue executing subsequent steps if a step fails',
    },
    once_for: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete array of fields that make the workflow run once as a JSON string',
    },
    expressions: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete array of workflow expressions as a JSON string',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state for the workflow (active, draft, or disabled)',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New folder for the workflow',
    },
    delay: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delay configuration as a JSON string',
    },
  },

  request: {
    url: (params) => `https://api.incident.io/v2/workflows/${params.id.trim()}`,
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        once_for: parseRequiredIncidentioJsonParam(params.once_for, 'once_for'),
        condition_groups: parseRequiredIncidentioJsonParam(
          params.condition_groups,
          'condition_groups'
        ),
        steps: parseRequiredIncidentioJsonParam(params.steps, 'steps'),
        expressions: parseRequiredIncidentioJsonParam(params.expressions, 'expressions'),
        include_private_incidents: params.include_private_incidents,
        runs_on_incident_modes: parseRequiredIncidentioJsonParam(
          params.runs_on_incident_modes,
          'runs_on_incident_modes'
        ),
        continue_on_step_error: params.continue_on_step_error,
        runs_on_incidents: params.runs_on_incidents,
      }

      if (params.state) body.state = params.state
      if (params.folder) body.folder = params.folder
      if (params.delay) body.delay = parseIncidentioJsonParam(params.delay, 'delay', undefined)

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        management_meta: data.management_meta,
        workflow: {
          id: data.workflow.id,
          name: data.workflow.name,
          state: data.workflow.state,
          folder: data.workflow.folder,
          created_at: data.workflow.created_at,
          updated_at: data.workflow.updated_at,
        },
      },
    }
  },

  outputs: {
    workflow: {
      type: 'object',
      description: 'The updated workflow',
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
    management_meta: {
      type: 'json',
      description: 'Workflow management metadata',
      optional: true,
    },
  },
}
