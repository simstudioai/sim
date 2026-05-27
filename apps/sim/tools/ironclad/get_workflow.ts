import type { IroncladGetWorkflowParams, IroncladGetWorkflowResponse } from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const getWorkflowTool: ToolConfig<IroncladGetWorkflowParams, IroncladGetWorkflowResponse> = {
  id: 'ironclad_get_workflow',
  name: 'Ironclad Get Workflow',
  description: 'Retrieve details of a specific workflow by its ID.',
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
    ironcladWorkflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the workflow',
    },
  },

  request: {
    url: (params) =>
      `https://na1.ironcladapp.com/public/api/v1/workflows/${params.ironcladWorkflowId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get workflow')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        status: data.status ?? null,
        template: data.template ?? null,
        creator: data.creator ?? null,
        step: data.step ?? null,
        attributes: data.attributes ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The workflow ID' },
    status: { type: 'string', description: 'The workflow status' },
    template: { type: 'string', description: 'The template used for the workflow' },
    creator: { type: 'string', description: 'The creator of the workflow' },
    step: { type: 'string', description: 'The current step of the workflow' },
    attributes: { type: 'json', description: 'The workflow attributes' },
  },
}
