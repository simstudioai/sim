import type { ToolConfig } from '@/tools/types'

interface UpdateMilestoneParams {
  owner: string
  repo: string
  milestone_number: number
  title?: string
  state?: 'open' | 'closed'
  description?: string
  due_on?: string
  apiKey: string
}

interface UpdateMilestoneResponse {
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
      updated_at: string
    }
  }
}

export const updateMilestoneTool: ToolConfig<UpdateMilestoneParams, UpdateMilestoneResponse> = {
  id: 'github_update_milestone',
  name: 'GitHub Update Milestone',
  description: 'Update a milestone in a repository',
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
      description: 'Milestone number to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New milestone title',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state: open or closed',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description',
    },
    due_on: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New due date (ISO 8601 format)',
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
    method: 'PATCH',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.state !== undefined) body.state = params.state
      if (params.description !== undefined) body.description = params.description
      if (params.due_on !== undefined) body.due_on = params.due_on
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Updated milestone: ${data.title} (#${data.number})
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
          updated_at: data.updated_at,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Updated milestone metadata',
      properties: {
        number: { type: 'number', description: 'Milestone number' },
        title: { type: 'string', description: 'Title' },
        description: { type: 'string', description: 'Description', optional: true },
        state: { type: 'string', description: 'State' },
        html_url: { type: 'string', description: 'Web URL' },
        due_on: { type: 'string', description: 'Due date', optional: true },
        open_issues: { type: 'number', description: 'Open issues' },
        closed_issues: { type: 'number', description: 'Closed issues' },
        updated_at: { type: 'string', description: 'Update date' },
      },
    },
  },
}

export const updateMilestoneV2Tool: ToolConfig<UpdateMilestoneParams, any> = {
  id: 'github_update_milestone_v2',
  name: updateMilestoneTool.name,
  description: updateMilestoneTool.description,
  version: '2.0.0',
  params: updateMilestoneTool.params,
  request: updateMilestoneTool.request,

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
    id: { type: 'number', description: 'Milestone ID' },
    node_id: { type: 'string', description: 'GraphQL node ID' },
    number: { type: 'number', description: 'Milestone number' },
    title: { type: 'string', description: 'Milestone title' },
    description: { type: 'string', description: 'Milestone description', optional: true },
    state: { type: 'string', description: 'State (open or closed)' },
    url: { type: 'string', description: 'API URL' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    labels_url: { type: 'string', description: 'Labels API URL' },
    due_on: { type: 'string', description: 'Due date (ISO 8601)', optional: true },
    open_issues: { type: 'number', description: 'Number of open issues' },
    closed_issues: { type: 'number', description: 'Number of closed issues' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    closed_at: { type: 'string', description: 'Close timestamp', optional: true },
    creator: {
      type: 'object',
      description: 'Milestone creator',
      optional: true,
      properties: {
        login: { type: 'string', description: 'Username' },
        id: { type: 'number', description: 'User ID' },
        node_id: { type: 'string', description: 'GraphQL node ID' },
        avatar_url: { type: 'string', description: 'Avatar image URL' },
        url: { type: 'string', description: 'API URL' },
        html_url: { type: 'string', description: 'Profile page URL' },
        type: { type: 'string', description: 'User or Organization' },
        site_admin: { type: 'boolean', description: 'GitHub staff indicator' },
      },
    },
  },
}
