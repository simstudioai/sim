import type { ToolConfig } from '@/tools/types'

export const yandexMusicGetUserProfileTool: ToolConfig = {
  id: 'yandex_music_get_user_profile',
  name: 'Retrieve User Profile Information',
  description: 'Fetches basic profile details for a given user ID.',
  version: '1.0.0',

  params: {
    user_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the user whose profile is being requested.',
    },
  },

  outputs: {
    user_id: {
      type: 'string',
      description: 'The unique ID of the user.',
    },
    display_name: {
      type: 'string',
      description: "User's chosen display name.",
      optional: true,
    },
    join_date: {
      type: 'string',
      description: 'Date the user registered.',
      optional: true,
    },
  },

  request: {
    url: (params) => `https://api.yandex.ru/music/v1/v1/users/${params.user_id}/profile`,
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      user_id: data.user_id ?? '',
      display_name: data.display_name ?? '',
      join_date: data.join_date ?? '',
    }
  },
}
