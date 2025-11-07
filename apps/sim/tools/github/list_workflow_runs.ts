import type { ListWorkflowRunsParams, ListWorkflowRunsResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowRunsTool: ToolConfig<ListWorkflowRunsParams, ListWorkflowRunsResponse> = {
  id: 'github_list_workflow_runs',
  name: 'GitHub List Workflow Runs',
  description:
    'List workflow runs for a repository. Supports filtering by actor, branch, event, and status. Returns run details including status, conclusion, and links.',
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
    actor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user who triggered the workflow',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by branch name',
    },
    event: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event type (e.g., push, pull_request, workflow_dispatch)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (queued, in_progress, completed, waiting, requested, pending)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default: 30, max: 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of results to fetch (default: 1)',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.github.com/repos/${params.owner}/${params.repo}/actions/runs`
      )
      if (params.actor) {
        url.searchParams.append('actor', params.actor)
      }
      if (params.branch) {
        url.searchParams.append('branch', params.branch)
      }
      if (params.event) {
        url.searchParams.append('event', params.event)
      }
      if (params.status) {
        url.searchParams.append('status', params.status)
      }
      if (params.per_page) {
        url.searchParams.append('per_page', Number(params.per_page).toString())
      }
      if (params.page) {
        url.searchParams.append('page', Number(params.page).toString())
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const statusCounts = data.workflow_runs.reduce((acc: Record<string, number>, run: any) => {
      acc[run.status] = (acc[run.status] || 0) + 1
      return acc
    }, {})

    const conclusionCounts = data.workflow_runs.reduce((acc: Record<string, number>, run: any) => {
      if (run.conclusion) {
        acc[run.conclusion] = (acc[run.conclusion] || 0) + 1
      }
      return acc
    }, {})

    const statusSummary = Object.entries(statusCounts)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ')

    const conclusionSummary = Object.entries(conclusionCounts)
      .map(([conclusion, count]) => `${count} ${conclusion}`)
      .join(', ')

    const content = `Found ${data.total_count} workflow run(s)
Status: ${statusSummary}
${conclusionSummary ? `Conclusion: ${conclusionSummary}` : ''}

Recent runs:
${data.workflow_runs
  .slice(0, 10)
  .map(
    (run: any) =>
      `- Run #${run.run_number}: ${run.name} (${run.status}${run.conclusion ? ` - ${run.conclusion}` : ''})
  Branch: ${run.head_branch}
  Triggered by: ${run.triggering_actor?.login || 'Unknown'}
  URL: ${run.html_url}`
  )
  .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: data.total_count,
          workflow_runs: data.workflow_runs.map((run: any) => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            html_url: run.html_url,
            run_number: run.run_number,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable workflow runs summary' },
    metadata: {
      type: 'object',
      description: 'Workflow runs metadata',
      properties: {
        total_count: { type: 'number', description: 'Total number of workflow runs' },
        workflow_runs: {
          type: 'array',
          description: 'Array of workflow run objects',
          items: {
            type: 'object',
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
      },
    },
  },
}
