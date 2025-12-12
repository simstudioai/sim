import type { LinearListFavoritesParams, LinearListFavoritesResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListFavoritesTool: ToolConfig<
  LinearListFavoritesParams,
  LinearListFavoritesResponse
> = {
  id: 'linear_list_favorites',
  name: 'Linear List Favorites',
  description: 'List all bookmarked items for the current user in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of favorites to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
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
    body: (params) => ({
      query: `
        query ListFavorites($first: Int, $after: String) {
          favorites(first: $first, after: $after) {
            nodes {
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
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list favorites',
        output: {},
      }
    }

    const result = data.data.favorites
    return {
      success: true,
      output: {
        favorites: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    favorites: {
      type: 'array',
      description: 'Array of favorited items',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Favorite ID' },
          type: { type: 'string', description: 'Favorite type' },
          issue: { type: 'object', description: 'Favorited issue' },
          project: { type: 'object', description: 'Favorited project' },
          cycle: { type: 'object', description: 'Favorited cycle' },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
    },
  },
}
