import type { ToolConfig } from '@/tools/types'

interface DeleteMilestoneParams {
  owner: string
  repo: string
  milestone_number: number
  apiKey: string
}

interface DeleteMilestoneResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      deleted: boolean
      milestone_number: number
    }
  }
}

export const deleteMilestoneTool: ToolConfig<DeleteMilestoneParams, DeleteMilestoneResponse> = {
  id: 'github_delete_milestone',
  name: 'GitHub Delete Milestone',
  description: 'Delete a milestone from a repository',
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
      description: 'Milestone number to delete',
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
    method: 'DELETE',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response, params) => {
    const deleted = response.status === 204

    return {
      success: deleted,
      output: {
        content: deleted
          ? `Successfully deleted milestone #${params?.milestone_number}`
          : `Failed to delete milestone #${params?.milestone_number}`,
        metadata: {
          deleted,
          milestone_number: params?.milestone_number ?? 0,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Delete operation metadata',
      properties: {
        deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
        milestone_number: { type: 'number', description: 'The deleted milestone number' },
      },
    },
  },
}

export const deleteMilestoneV2Tool: ToolConfig<DeleteMilestoneParams, any> = {
  id: 'github_delete_milestone_v2',
  name: deleteMilestoneTool.name,
  description: deleteMilestoneTool.description,
  version: '2.0.0',
  params: deleteMilestoneTool.params,
  request: deleteMilestoneTool.request,

  transformResponse: async (response: Response, params) => {
    const deleted = response.status === 204
    return {
      success: deleted,
      output: {
        deleted,
        milestone_number: params?.milestone_number ?? 0,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    milestone_number: { type: 'number', description: 'The deleted milestone number' },
  },
}
