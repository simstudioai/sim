import { MILESTONE_CREATOR_OUTPUT, MILESTONE_V2_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface GetMilestoneParams {
  owner: string
  repo: string
  milestone_number: number
  apiKey: string
}

interface GetMilestoneResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      number: number
      title: string
      description: string | null
      state: string
      html_url: string
      due_on: string | null
      open_issues: number
      closed_issues: number
      created_at: string
      updated_at: string
      closed_at: string | null
      creator: { login: string }
    }
  }
}

export const getMilestoneTool: ToolConfig<GetMilestoneParams, GetMilestoneResponse> = {
  id: 'github_get_milestone',
  name: 'GitHub Get Milestone',
  description: 'Get a specific milestone by number',
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
    milestone_number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Milestone number',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/milestones/${params.milestone_number}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const progress =
      data.open_issues + data.closed_issues > 0
        ? Math.round((data.closed_issues / (data.open_issues + data.closed_issues)) * 100)
        : 0

    const content = `Milestone: ${data.title} (#${data.number})
State: ${data.state} | Progress: ${progress}% (${data.closed_issues}/${data.open_issues + data.closed_issues} issues)
Due: ${data.due_on ?? 'No due date'}
Description: ${data.description ?? 'No description'}
${data.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: data.number,
          title: data.title,
          description: data.description ?? null,
          state: data.state,
          html_url: data.html_url,
          due_on: data.due_on ?? null,
          open_issues: data.open_issues,
          closed_issues: data.closed_issues,
          created_at: data.created_at,
          updated_at: data.updated_at,
          closed_at: data.closed_at ?? null,
          creator: { login: data.creator?.login ?? 'unknown' },
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable milestone details' },
    metadata: {
      type: 'object',
      description: 'Milestone metadata',
      properties: {
        number: { type: 'number', description: 'Milestone number' },
        title: { type: 'string', description: 'Title' },
        description: { type: 'string', description: 'Description', optional: true },
        state: { type: 'string', description: 'State' },
        html_url: { type: 'string', description: 'Web URL' },
        due_on: { type: 'string', description: 'Due date', optional: true },
        open_issues: { type: 'number', description: 'Open issues count' },
        closed_issues: { type: 'number', description: 'Closed issues count' },
        created_at: { type: 'string', description: 'Creation date' },
        updated_at: { type: 'string', description: 'Update date' },
        closed_at: { type: 'string', description: 'Close date', optional: true },
        creator: { type: 'object', description: 'Creator info' },
      },
    },
  },
}

export const getMilestoneV2Tool: ToolConfig<GetMilestoneParams, any> = {
  id: 'github_get_milestone_v2',
  name: getMilestoneTool.name,
  description: getMilestoneTool.description,
  version: '2.0.0',
  params: getMilestoneTool.params,
  request: getMilestoneTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        description: data.description ?? null,
        due_on: data.due_on ?? null,
        closed_at: data.closed_at ?? null,
      },
    }
  },

  outputs: {
    ...MILESTONE_V2_OUTPUT_PROPERTIES,
    creator: MILESTONE_CREATOR_OUTPUT,
  },
}
