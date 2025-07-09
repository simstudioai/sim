import type { ToolConfig } from '../types'

export const getUserWorkflowTool: ToolConfig = {
  id: 'get_user_workflow',
  name: 'Get User Workflow',
  description:
    'Get the current user workflow as YAML format. This shows all blocks, their configurations, inputs, and connections in the workflow.',
  version: '1.0.0',

  params: {
    includeMetadata: {
      type: 'boolean',
      required: false,
      description: 'Whether to include additional metadata about the workflow (default: false)',
    },
  },

  request: {
    url: '/api/workflows/current/yaml',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      includeMetadata: params.includeMetadata || false,
    }),
    isInternalRoute: true,
  },
}
