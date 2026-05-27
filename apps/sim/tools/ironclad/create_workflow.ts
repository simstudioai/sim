import type {
  IroncladCreateWorkflowParams,
  IroncladCreateWorkflowResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const createWorkflowTool: ToolConfig<
  IroncladCreateWorkflowParams,
  IroncladCreateWorkflowResponse
> = {
  id: 'ironclad_create_workflow',
  name: 'Ironclad Create Workflow',
  description: 'Create a new workflow in Ironclad using a specified template and attributes.',
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
    template: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The template ID to use for the workflow',
    },
    attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of workflow attributes',
    },
  },

  request: {
    url: () => 'https://na1.ironcladapp.com/public/api/v1/workflows',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        template: params.template,
      }
      if (params.attributes) {
        try {
          body.attributes = JSON.parse(params.attributes)
        } catch {
          throw new Error('Invalid JSON in attributes field')
        }
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create workflow')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        status: data.status ?? null,
        template: data.template ?? null,
        creator: data.creator ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The ID of the created workflow' },
    status: { type: 'string', description: 'The status of the workflow' },
    template: { type: 'string', description: 'The template used for the workflow' },
    creator: { type: 'string', description: 'The creator of the workflow' },
  },
}
