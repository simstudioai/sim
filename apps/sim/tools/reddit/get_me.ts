import type { RedditGetMeParams, RedditUserResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const getMeTool: ToolConfig<RedditGetMeParams, RedditUserResponse> = {
  id: 'reddit_get_me',
  name: 'Get Reddit User Identity',
  description: 'Get information about the authenticated Reddit user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
  },

  request: {
    url: () => 'https://oauth.reddit.com/api/v1/me?raw_json=1',
    method: 'GET',
    headers: (params: RedditGetMeParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          id: '',
          name: '',
          created_utc: 0,
          link_karma: 0,
          comment_karma: 0,
          total_karma: 0,
          is_gold: false,
          is_mod: false,
          has_verified_email: false,
          icon_img: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        created_utc: data.created_utc ?? 0,
        link_karma: data.link_karma ?? 0,
        comment_karma: data.comment_karma ?? 0,
        total_karma: data.total_karma ?? 0,
        is_gold: data.is_gold ?? false,
        is_mod: data.is_mod ?? false,
        has_verified_email: data.has_verified_email ?? false,
        icon_img: data.icon_img ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'User ID' },
    name: { type: 'string', description: 'Username' },
    created_utc: { type: 'number', description: 'Account creation time in UTC epoch seconds' },
    link_karma: { type: 'number', description: 'Total link karma' },
    comment_karma: { type: 'number', description: 'Total comment karma' },
    total_karma: { type: 'number', description: 'Combined total karma' },
    is_gold: { type: 'boolean', description: 'Whether user has Reddit Premium' },
    is_mod: { type: 'boolean', description: 'Whether user is a moderator' },
    has_verified_email: { type: 'boolean', description: 'Whether email is verified' },
    icon_img: { type: 'string', description: 'User avatar/icon URL' },
  },
}
