import type { WorkflowsCreateParams, WorkflowsCreateResponse } from '@/tools/incidentio/types'
import { INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES } from '@/tools/incidentio/types'
import { mapIncidentioWorkflow, parseIncidentioJsonParam } from '@/tools/incidentio/utils'
import type { ToolConfig } from '@/tools/types'

export const workflowsCreateTool: ToolConfig<WorkflowsCreateParams, WorkflowsCreateResponse> = {
  id: 'incidentio_workflows_create',
  name: 'incident.io Workflows Create',
  description: 'Create a new workflow in incident.io.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the workflow (e.g., "Notify on Critical Incidents")',
    },
    folder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Folder to organize the workflow in',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State of the workflow (active, draft, or disabled)',
      default: 'draft',
    },
    trigger: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trigger type for the workflow (e.g., "incident.updated", "incident.created")',
      default: 'incident.updated',
    },
    steps: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of workflow steps as JSON string. Example: [{"label": "Notify team", "name": "slack.post_message"}]',
      default: '[]',
    },
    condition_groups: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of condition groups as JSON string to control when the workflow runs. Example: [{"conditions": [{"operation": "one_of", "param_bindings": [], "subject": "incident.severity"}]}]',
      default: '[]',
    },
    runs_on_incidents: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When to run the workflow: "newly_created" (only new incidents), "newly_created_and_active" (new and active incidents), "active" (only active incidents), or "all" (all incidents)',
      default: 'newly_created',
    },
    runs_on_incident_modes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of incident modes to run on as JSON string. Example: ["standard", "retrospective"]',
      default: '["standard"]',
    },
    include_private_incidents: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include private incidents',
      default: true,
    },
    continue_on_step_error: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to continue executing subsequent steps if a step fails',
      default: false,
    },
    once_for: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of fields to ensure the workflow runs only once per unique combination of these fields, as JSON string. Example: ["incident.id"]',
      default: '[]',
    },
    expressions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of workflow expressions as JSON string for advanced workflow logic. Example: [{"label": "My expression", "operations": []}]',
      default: '[]',
    },
    delay: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Delay configuration as JSON string. Example: {"for_seconds": 60, "conditions_apply_over_delay": false}',
    },
  },

  request: {
    url: 'https://api.incident.io/v2/workflows',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        trigger: params.trigger || 'incident.updated',
        once_for: parseIncidentioJsonParam(params.once_for, 'once_for', []),
        condition_groups: parseIncidentioJsonParam(params.condition_groups, 'condition_groups', []),
        steps: parseIncidentioJsonParam(params.steps, 'steps', []),
        expressions: parseIncidentioJsonParam(params.expressions, 'expressions', []),
        include_private_incidents: params.include_private_incidents ?? true,
        runs_on_incident_modes: parseIncidentioJsonParam(
          params.runs_on_incident_modes,
          'runs_on_incident_modes',
          ['standard']
        ),
        continue_on_step_error: params.continue_on_step_error ?? false,
        runs_on_incidents: params.runs_on_incidents || 'newly_created',
        state: params.state || 'draft',
      }

      if (params.folder) {
        body.folder = params.folder
      }

      if (params.delay) {
        body.delay = parseIncidentioJsonParam(params.delay, 'delay', undefined)
      }

      return body
    },
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
      description: 'The created workflow',
      properties: INCIDENTIO_WORKFLOW_OUTPUT_PROPERTIES,
    },
    management_meta: {
      type: 'json',
      description: 'Workflow management metadata',
      optional: true,
    },
  },
}
