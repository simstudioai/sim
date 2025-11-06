import type { GetWorkflowRunParams, WorkflowRunResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getWorkflowRunTool: ToolConfig<GetWorkflowRunParams, WorkflowRunResponse> = {
  id: 'github_get_workflow_run',
  name: 'GitHub Get Workflow Run',
  description:
    'Get detailed information about a specific workflow run by ID. Returns status, conclusion, timing, and links to the run.',
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
    run_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow run ID',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Workflow Run #${data.run_number}: ${data.name}
Status: ${data.status}${data.conclusion ? ` - ${data.conclusion}` : ''}
Branch: ${data.head_branch}
Commit: ${data.head_sha.substring(0, 7)}
Event: ${data.event}
Triggered by: ${data.triggering_actor?.login || 'Unknown'}
Started: ${data.run_started_at || data.created_at}
${data.updated_at ? `Updated: ${data.updated_at}` : ''}
${data.run_attempt ? `Attempt: ${data.run_attempt}` : ''}
URL: ${data.html_url}
Logs: ${data.logs_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          name: data.name,
          status: data.status,
          conclusion: data.conclusion,
          html_url: data.html_url,
          run_number: data.run_number,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable workflow run details' },
    metadata: {
      type: 'object',
      description: 'Workflow run metadata',
      properties: {
        id: { type: 'number', description: 'Workflow run ID' },
        name: { type: 'string', description: 'Workflow name' },
        status: { type: 'string', description: 'Run status' },
        conclusion: { type: 'string', description: 'Run conclusion' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        run_number: { type: 'number', description: 'Run number' },
      },
    },
  },
}
