import { MILESTONE_CREATOR_OUTPUT, MILESTONE_V2_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface ListMilestonesParams {
  owner: string
  repo: string
  state?: 'open' | 'closed' | 'all'
  sort?: 'due_on' | 'completeness'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
  apiKey: string
}

interface ListMilestonesResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      milestones: Array<{
        number: number
        title: string
        description: string | null
        state: string
        html_url: string
        due_on: string | null
        open_issues: number
        closed_issues: number
      }>
      count: number
    }
  }
}

export const listMilestonesTool: ToolConfig<ListMilestonesParams, ListMilestonesResponse> = {
  id: 'github_list_milestones',
  name: 'GitHub List Milestones',
  description: 'List milestones in a repository',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by state: open, closed, all (default: open)',
      default: 'open',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by: due_on or completeness (default: due_on)',
      default: 'due_on',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc (default: asc)',
      default: 'asc',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (max 100, default: 30)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/milestones`)
      if (params.state) url.searchParams.append('state', params.state)
      if (params.sort) url.searchParams.append('sort', params.sort)
      if (params.direction) url.searchParams.append('direction', params.direction)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const milestones = data.map((m: any) => {
      const total = m.open_issues + m.closed_issues
      const progress = total > 0 ? Math.round((m.closed_issues / total) * 100) : 0
      return {
        number: m.number,
        title: m.title,
        description: m.description ?? null,
        state: m.state,
        html_url: m.html_url,
        due_on: m.due_on ?? null,
        open_issues: m.open_issues,
        closed_issues: m.closed_issues,
        progress,
      }
    })

    const content = `Found ${milestones.length} milestone(s):
${milestones
  .map(
    (m: any) =>
      `#${m.number}: ${m.title} (${m.state})
  Progress: ${m.progress}% (${m.closed_issues}/${m.open_issues + m.closed_issues} issues)
  Due: ${m.due_on ?? 'No due date'}
  ${m.html_url}`
  )
  .join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          milestones,
          count: milestones.length,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable milestone list' },
    metadata: {
      type: 'object',
      description: 'Milestones metadata',
      properties: {
        milestones: {
          type: 'array',
          description: 'Array of milestones',
          items: {
            type: 'object',
            properties: {
              number: { type: 'number', description: 'Milestone number' },
              title: { type: 'string', description: 'Title' },
              description: { type: 'string', description: 'Description', optional: true },
              state: { type: 'string', description: 'State' },
              html_url: { type: 'string', description: 'Web URL' },
              due_on: { type: 'string', description: 'Due date', optional: true },
              open_issues: { type: 'number', description: 'Open issues' },
              closed_issues: { type: 'number', description: 'Closed issues' },
            },
          },
        },
        count: { type: 'number', description: 'Number of milestones returned' },
      },
    },
  },
}

export const listMilestonesV2Tool: ToolConfig<ListMilestonesParams, any> = {
  id: 'github_list_milestones_v2',
  name: listMilestonesTool.name,
  description: listMilestonesTool.description,
  version: '2.0.0',
  params: listMilestonesTool.params,
  request: listMilestonesTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        items: data.map((m: any) => ({
          ...m,
          description: m.description ?? null,
          due_on: m.due_on ?? null,
        })),
        count: data.length,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of milestone objects from GitHub API',
      items: {
        type: 'object',
        properties: {
          ...MILESTONE_V2_OUTPUT_PROPERTIES,
          creator: MILESTONE_CREATOR_OUTPUT,
        },
      },
    },
    count: { type: 'number', description: 'Number of milestones returned' },
  },
}
