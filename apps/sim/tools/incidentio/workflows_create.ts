import type { WorkflowsCreateParams, WorkflowsCreateResponse } from '@/tools/incidentio/types'
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
      // Helper function to safely parse JSON strings
      const parseJsonParam = (jsonString: string | undefined, defaultValue: any) => {
        if (!jsonString) return defaultValue
        try {
          return JSON.parse(jsonString)
        } catch (error) {
          console.warn(`Failed to parse JSON parameter: ${jsonString}`, error)
          return defaultValue
        }
      }

      // incident.io requires all these fields to create a workflow
      const body: Record<string, any> = {
        name: params.name,
        trigger: params.trigger || 'incident.updated',
        once_for: parseJsonParam(params.once_for, []),
        condition_groups: parseJsonParam(params.condition_groups, []),
        steps: parseJsonParam(params.steps, []),
        expressions: parseJsonParam(params.expressions, []),
        include_private_incidents: params.include_private_incidents ?? true,
        runs_on_incident_modes: parseJsonParam(params.runs_on_incident_modes, ['standard']),
        continue_on_step_error: params.continue_on_step_error ?? false,
        runs_on_incidents: params.runs_on_incidents || 'newly_created',
        state: params.state || 'draft',
      }

      if (params.folder) {
        body.folder = params.folder
      }

      if (params.delay) {
        body.delay = parseJsonParam(params.delay, undefined)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
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
      description: 'The created workflow',
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
}
