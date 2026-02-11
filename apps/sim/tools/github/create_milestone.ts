import { MILESTONE_CREATOR_OUTPUT, MILESTONE_V2_OUTPUT_PROPERTIES } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

interface CreateMilestoneParams {
  owner: string
  repo: string
  title: string
  state?: 'open' | 'closed'
  description?: string
  due_on?: string
  apiKey: string
}

interface CreateMilestoneResponse {
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
      creator: { login: string }
    }
  }
}

export const createMilestoneTool: ToolConfig<CreateMilestoneParams, CreateMilestoneResponse> = {
  id: 'github_create_milestone',
  name: 'GitHub Create Milestone',
  description: 'Create a milestone in a repository',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Milestone title',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State: open or closed (default: open)',
      default: 'open',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Milestone description',
    },
    due_on: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (ISO 8601 format, e.g., 2024-12-31T23:59:59Z)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) => `https://api.github.com/repos/${params.owner}/${params.repo}/milestones`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => ({
      title: params.title,
      state: params.state ?? 'open',
      description: params.description,
      due_on: params.due_on,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Created milestone: ${data.title}
Number: ${data.number}
State: ${data.state}
Due: ${data.due_on ?? 'No due date'}
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
          creator: { login: data.creator?.login ?? 'unknown' },
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
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
        creator: { type: 'object', description: 'Creator info' },
      },
    },
  },
}

export const createMilestoneV2Tool: ToolConfig<CreateMilestoneParams, any> = {
  id: 'github_create_milestone_v2',
  name: createMilestoneTool.name,
  description: createMilestoneTool.description,
  version: '2.0.0',
  params: createMilestoneTool.params,
  request: createMilestoneTool.request,

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ...data,
        description: data.description ?? null,
        due_on: data.due_on ?? null,
      },
    }
  },

  outputs: {
    ...MILESTONE_V2_OUTPUT_PROPERTIES,
    creator: MILESTONE_CREATOR_OUTPUT,
  },
}
