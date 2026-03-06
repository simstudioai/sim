import { validatePathSegment } from '@/lib/core/security/input-validation'
import type { RedditGetUserParams, RedditUserResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<RedditGetUserParams, RedditUserResponse> = {
  id: 'reddit_get_user',
  name: 'Get Reddit User Profile',
  description: 'Get public profile information about any Reddit user by username',
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
    username: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reddit username to look up (e.g., "spez", "example_user")',
    },
  },

  request: {
    url: (params: RedditGetUserParams) => {
      const username = params.username.trim().replace(/^u\//, '')
      const validation = validatePathSegment(username, { paramName: 'username' })
      if (!validation.isValid) {
        throw new Error(validation.error)
      }
      return `https://oauth.reddit.com/user/${username}/about?raw_json=1`
    },
    method: 'GET',
    headers: (params: RedditGetUserParams) => {
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

    const user = data.data || data

    return {
      success: true,
      output: {
        id: user.id ?? '',
        name: user.name ?? '',
        created_utc: user.created_utc ?? 0,
        link_karma: user.link_karma ?? 0,
        comment_karma: user.comment_karma ?? 0,
        total_karma: user.total_karma ?? 0,
        is_gold: user.is_gold ?? false,
        is_mod: user.is_mod ?? false,
        has_verified_email: user.has_verified_email ?? false,
        icon_img: user.icon_img ?? '',
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
