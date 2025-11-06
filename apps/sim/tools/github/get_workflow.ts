import type { GetWorkflowParams, WorkflowResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getWorkflowTool: ToolConfig<GetWorkflowParams, WorkflowResponse> = {
  id: 'github_get_workflow',
  name: 'GitHub Get Workflow',
  description:
    'Get details of a specific GitHub Actions workflow by ID or filename. Returns workflow information including name, path, state, and badge URL.',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    workflow_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow ID (number) or workflow filename (e.g., "main.yaml")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Workflow: ${data.name}
State: ${data.state}
Path: ${data.path}
ID: ${data.id}
Badge URL: ${data.badge_url}
Created: ${data.created_at}
Updated: ${data.updated_at}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          name: data.name,
          path: data.path,
          state: data.state,
          badge_url: data.badge_url,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable workflow details' },
    metadata: {
      type: 'object',
      description: 'Workflow metadata',
      properties: {
        id: { type: 'number', description: 'Workflow ID' },
        name: { type: 'string', description: 'Workflow name' },
        path: { type: 'string', description: 'Path to workflow file' },
        state: { type: 'string', description: 'Workflow state (active/disabled)' },
        badge_url: { type: 'string', description: 'Badge URL for workflow' },
      },
    },
  },
}
