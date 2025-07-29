import type { ToolConfig, ToolResponse } from '@/tools/types'

interface GetWorkflowParams {
  includeMetadata?: boolean
  _context?: {
    workflowId: string
  }
}

interface GetWorkflowResponse extends ToolResponse {
  output: {
    yaml: string
    metadata?: {
      blockCount: number
      connectionCount: number
      lastModified: string
    }
  }
}

export const getUserWorkflowTool: ToolConfig<GetWorkflowParams, GetWorkflowResponse> = {
  id: 'get_user_workflow',
  name: 'Get User Workflow',
  description:
    "Get the current user's specific workflow (not general Sim documentation). Returns YAML format showing only the blocks that the user has actually built in their workflow, with their specific configurations, inputs, and connections.",
  version: '1.0.0',

  params: {
    includeMetadata: {
      type: 'boolean',
      required: false,
      description: 'Whether to include additional metadata about the workflow (default: false)',
    },
  },

  // Use API endpoint to avoid Node.js module import issues in browser
  request: {
    url: '/api/tools/get-user-workflow',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      workflowId: params._context?.workflowId,
      includeMetadata: params.includeMetadata || false,
    }),
    isInternalRoute: true,
  },
}
