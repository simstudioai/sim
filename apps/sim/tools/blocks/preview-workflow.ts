import type { ToolConfig } from '../types'

interface PreviewWorkflowParams {
  yamlContent: string
  description?: string
  _context?: {
    workflowId?: string
    chatId?: string
  }
}

interface PreviewWorkflowResponse {
  success: boolean
  output: {
    success: boolean
    workflowState?: any
    message?: string
    summary?: string
    data?: {
      blocksCount: number
      edgesCount: number
      loopsCount: number
      parallelsCount: number
    }
    errors?: string[]
    warnings?: string[]
  }
}

export const previewWorkflowTool: ToolConfig<PreviewWorkflowParams, PreviewWorkflowResponse> = {
  id: 'preview_workflow',
  name: 'Preview Workflow',
  description:
    'Generate a sandbox preview of the workflow without saving it. This allows users to see the proposed changes before applying them. Always use this instead of directly editing when showing workflow proposals.',
  version: '1.0.0',

  params: {
    yamlContent: {
      type: 'string',
      required: true,
      description: 'The complete YAML workflow content to preview',
    },
    description: {
      type: 'string',
      required: false,
      description: 'Optional description of the proposed changes',
    },
  },

  request: {
    url: () => '/api/workflows/preview',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      yamlContent: params.yamlContent,
      applyAutoLayout: true, // Always apply auto layout for previews
    }),
    isInternalRoute: true,
  },

  transformResponse: async (response: Response): Promise<PreviewWorkflowResponse> => {
    if (!response.ok) {
      throw new Error(`Preview workflow failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.message || 'Failed to preview workflow')
    }

    return {
      success: true,
      output: data,
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Failed to preview workflow: ${error.message}`
    }
    return 'An unexpected error occurred while previewing the workflow'
  },
}
