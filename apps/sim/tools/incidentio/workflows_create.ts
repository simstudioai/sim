import type { ToolConfig } from '@/tools/types'
import type { WorkflowsCreateParams, WorkflowsCreateResponse } from './types'

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
      description: 'Name of the workflow',
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
      default: 'active',
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
      // incident.io requires all these fields to create a workflow
      const body: Record<string, any> = {
        name: params.name,
        trigger: 'incident.updated',
        once_for: [],
        condition_groups: [],
        steps: [],
        expressions: [],
        include_private_incidents: true,
        runs_on_incident_modes: ['standard'],
        continue_on_step_error: false,
        runs_on_incidents: 'newly_created',
        state: params.state || 'draft',
      }

      if (params.folder) {
        body.folder = params.folder
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
