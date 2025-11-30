import type { GetProfileParams, GetProfileResponse } from '@/tools/linkedin/types'
import type { ToolConfig } from '@/tools/types'

export const linkedInGetProfileTool: ToolConfig<GetProfileParams, GetProfileResponse> = {
  id: 'linkedin_get_profile',
  name: 'Get LinkedIn Profile',
  description: 'Retrieve your LinkedIn profile information',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linkedin',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for LinkedIn API',
    },
  },

  request: {
    url: () => 'https://api.linkedin.com/v2/userinfo',
    method: 'GET',
    headers: (params: GetProfileParams): Record<string, string> => ({
      Authorization: `Bearer ${params.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    }),
  },

  transformResponse: async (response: Response): Promise<GetProfileResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {},
        error: `Failed to get profile: ${response.statusText}`,
      }
    }

    const profile = await response.json()

    return {
      success: true,
      output: {
        profile: {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          picture: profile.picture,
        },
      },
    }
  },
}
