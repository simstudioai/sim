import type { LinearCreateFavoriteParams, LinearCreateFavoriteResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateFavoriteTool: ToolConfig<
  LinearCreateFavoriteParams,
  LinearCreateFavoriteResponse
> = {
  id: 'linear_create_favorite',
  name: 'Linear Create Favorite',
  description: 'Bookmark an issue, project, cycle, or label in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    issueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issue ID to favorite',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID to favorite',
    },
    cycleId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cycle ID to favorite',
    },
    labelId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label ID to favorite',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => {
      const input: Record<string, any> = {}

      if (params.issueId !== undefined && params.issueId !== null && params.issueId !== '')
        input.issueId = params.issueId
      if (params.projectId !== undefined && params.projectId !== null && params.projectId !== '')
        input.projectId = params.projectId
      if (params.cycleId !== undefined && params.cycleId !== null && params.cycleId !== '')
        input.cycleId = params.cycleId
      if (params.labelId !== undefined && params.labelId !== null && params.labelId !== '')
        input.labelId = params.labelId

      if (Object.keys(input).length === 0) {
        throw new Error('At least one ID (issue, project, cycle, or label) must be provided')
      }

      return {
        query: `
          mutation CreateFavorite($input: FavoriteCreateInput!) {
            favoriteCreate(input: $input) {
              success
              favorite {
                id
                type
                issue {
                  id
                  title
                }
                project {
                  id
                  name
                }
                cycle {
                  id
                  name
                }
              }
            }
          }
        `,
        variables: {
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create favorite',
        output: {},
      }
    }

    const result = data.data.favoriteCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Favorite creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        favorite: result.favorite,
      },
    }
  },

  outputs: {
    favorite: {
      type: 'object',
      description: 'The created favorite',
      properties: {
        id: { type: 'string', description: 'Favorite ID' },
        type: { type: 'string', description: 'Favorite type' },
        issue: { type: 'object', description: 'Favorited issue (if applicable)' },
        project: { type: 'object', description: 'Favorited project (if applicable)' },
        cycle: { type: 'object', description: 'Favorited cycle (if applicable)' },
      },
    },
  },
}
