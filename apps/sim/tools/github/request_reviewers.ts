import type { RequestReviewersParams, ReviewersResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const requestReviewersTool: ToolConfig<RequestReviewersParams, ReviewersResponse> = {
  id: 'github_request_reviewers',
  name: 'GitHub Request Reviewers',
  description: 'Request reviewers for a pull request',
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
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    reviewers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of user logins to request reviews from',
    },
    team_reviewers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of team slugs to request reviews from',
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
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/requested_reviewers`,
    method: 'POST',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const reviewersArray = params.reviewers
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r)
      const body: Record<string, any> = {
        reviewers: reviewersArray,
      }
      if (params.team_reviewers) {
        const teamReviewersArray = params.team_reviewers
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
        if (teamReviewersArray.length > 0) {
          body.team_reviewers = teamReviewersArray
        }
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const pr = await response.json()

    const reviewers = pr.requested_reviewers || []
    const teams = pr.requested_teams || []

    const reviewersList = reviewers.map((r: any) => r.login).join(', ')
    const teamsList = teams.map((t: any) => t.name).join(', ')

    let content = `Review requested for PR #${pr.number}
Reviewers: ${reviewersList || 'None'}`

    if (teamsList) {
      content += `
Team Reviewers: ${teamsList}`
    }

    return {
      success: true,
      output: {
        content,
        metadata: {
          requested_reviewers: reviewers.map((r: any) => ({
            login: r.login,
            id: r.id,
          })),
          requested_teams: teams.length
            ? teams.map((t: any) => ({
                name: t.name,
                id: t.id,
              }))
            : undefined,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable reviewer request confirmation' },
    metadata: {
      type: 'object',
      description: 'Requested reviewers metadata',
      properties: {
        requested_reviewers: {
          type: 'array',
          description: 'Array of requested reviewer users',
          items: {
            type: 'object',
            properties: {
              login: { type: 'string', description: 'User login' },
              id: { type: 'number', description: 'User ID' },
            },
          },
        },
        requested_teams: {
          type: 'array',
          description: 'Array of requested reviewer teams',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Team name' },
              id: { type: 'number', description: 'Team ID' },
            },
          },
        },
      },
    },
  },
}
