import type { ListWorkflowsParams, ListWorkflowsResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowsTool: ToolConfig<ListWorkflowsParams, ListWorkflowsResponse> = {
  id: 'github_list_workflows',
  name: 'GitHub List Workflows',
  description:
    'List all workflows in a GitHub repository. Returns workflow details including ID, name, path, state, and badge URL.',
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
        `https://api.github.com/repos/${params.owner}/${params.repo}/actions/workflows`
      )
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

    const stateCounts = data.workflows.reduce((acc: Record<string, number>, workflow: any) => {
      acc[workflow.state] = (acc[workflow.state] || 0) + 1
      return acc
    }, {})

    const statesSummary = Object.entries(stateCounts)
      .map(([state, count]) => `${count} ${state}`)
      .join(', ')

    const content = `Found ${data.total_count} workflow(s) in ${data.workflows[0]?.path.split('/')[0] || '.github/workflows'}
States: ${statesSummary}

Workflows:
${data.workflows
  .map(
    (w: any) =>
      `- ${w.name} (${w.state})
  Path: ${w.path}
  ID: ${w.id}
  Badge: ${w.badge_url}`
  )
  .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: data.total_count,
          workflows: data.workflows.map((workflow: any) => ({
            id: workflow.id,
            name: workflow.name,
            path: workflow.path,
            state: workflow.state,
            badge_url: workflow.badge_url,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable workflows summary' },
    metadata: {
      type: 'object',
      description: 'Workflows metadata',
      properties: {
        total_count: { type: 'number', description: 'Total number of workflows' },
        workflows: {
          type: 'array',
          description: 'Array of workflow objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Workflow ID' },
              name: { type: 'string', description: 'Workflow name' },
              path: { type: 'string', description: 'Path to workflow file' },
              state: { type: 'string', description: 'Workflow state (active/disabled)' },
              badge_url: { type: 'string', description: 'Badge URL for workflow' },
            },
          },
        },
      },
    },
  },
}
