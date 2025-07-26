import type { ToolConfig, ToolResponse } from '@/tools/types'

interface EditWorkflowParams {
  yamlContent: string
  description?: string
  _context?: {
    workflowId: string
    chatId?: string
  }
}

interface EditWorkflowResponse extends ToolResponse {
  output: {
    success: boolean
    message: string
    summary?: string
    errors: string[]
    warnings: string[]
    data?: {
      blocksCount: number
      edgesCount: number
      loopsCount: number
      parallelsCount: number
    }
  }
}

export const editWorkflowTool: ToolConfig<EditWorkflowParams, EditWorkflowResponse> = {
  id: 'edit_workflow',
  name: 'Edit Workflow',
  description:
    'Save/edit the current workflow by providing YAML content. This performs the same action as saving in the YAML code editor. Only call this after getting blocks info, metadata, and YAML structure guide.',
  version: '1.0.0',

  params: {
    yamlContent: {
      type: 'string',
      required: true,
      description: 'The complete YAML workflow content to save',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Optional description of the changes being made',
    },
  },

  request: {
    url: (params) => `/api/workflows/${params._context?.workflowId}/yaml`,
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      yamlContent: params.yamlContent,
      description: params.description,
      chatId: params._context?.chatId,
      source: 'copilot',
      applyAutoLayout: true,
      createCheckpoint: true, // Always create checkpoints for copilot edits
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<EditWorkflowResponse> => {
    if (!response.ok) {
      throw new Error(`Edit workflow failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.message || 'Failed to edit workflow')
    }

    return {
      success: true,
      output: data,
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Failed to edit workflow: ${error.message}`
    }
    return 'An unexpected error occurred while editing the workflow'
  },
}
