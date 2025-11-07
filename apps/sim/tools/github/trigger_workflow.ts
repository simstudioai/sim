import type { TriggerWorkflowParams, TriggerWorkflowResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const triggerWorkflowTool: ToolConfig<TriggerWorkflowParams, TriggerWorkflowResponse> = {
  id: 'github_trigger_workflow',
  name: 'GitHub Trigger Workflow',
  description:
    'Trigger a workflow dispatch event for a GitHub Actions workflow. The workflow must have a workflow_dispatch trigger configured. Returns 204 No Content on success.',
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
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Git reference (branch or tag name) to run the workflow on',
    },
    inputs: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Input keys and values configured in the workflow file',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}/dispatches`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      ref: params.ref,
      ...(params.inputs && { inputs: params.inputs }),
    }),
  },

  transformResponse: async (response) => {
    const content = `Workflow dispatched successfully on ref: ${response.url.includes('ref') ? 'requested ref' : 'default branch'}
The workflow run should start shortly.`

    return {
      success: true,
      output: {
        content,
        metadata: {},
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Confirmation message' },
    metadata: {
      type: 'object',
      description: 'Empty metadata object (204 No Content response)',
    },
  },
}
