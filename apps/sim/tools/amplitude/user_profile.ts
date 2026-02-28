import type {
  AmplitudeUserProfileParams,
  AmplitudeUserProfileResponse,
} from '@/tools/amplitude/types'
import type { ToolConfig } from '@/tools/types'

export const userProfileTool: ToolConfig<AmplitudeUserProfileParams, AmplitudeUserProfileResponse> =
  {
    id: 'amplitude_user_profile',
    name: 'Amplitude User Profile',
    description:
      'Get a user profile including properties, cohort memberships, and computed properties.',
    version: '1.0.0',

    params: {
      secretKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Amplitude Secret Key',
      },
      userId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'External user ID (required if no device_id)',
      },
      deviceId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Device ID (required if no user_id)',
      },
      getAmpProps: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include Amplitude user properties (true/false, default: false)',
      },
      getCohortIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include cohort IDs the user belongs to (true/false, default: false)',
      },
      getComputations: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Include computed user properties (true/false, default: false)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://profile-api.amplitude.com/v1/userprofile')
        if (params.userId) url.searchParams.set('user_id', params.userId.trim())
        if (params.deviceId) url.searchParams.set('device_id', params.deviceId.trim())
        if (params.getAmpProps) url.searchParams.set('get_amp_props', params.getAmpProps)
        if (params.getCohortIds) url.searchParams.set('get_cohort_ids', params.getCohortIds)
        if (params.getComputations) url.searchParams.set('get_computations', params.getComputations)
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Api-Key ${params.secretKey}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Amplitude User Profile API error: ${response.status}`)
      }

      const userData = data.userData ?? {}

      return {
        success: true,
        output: {
          userId: (userData.user_id as string) ?? null,
          deviceId: (userData.device_id as string) ?? null,
          ampProps: (userData.amp_props as Record<string, unknown>) ?? null,
          cohortIds: (userData.cohort_ids as string[]) ?? null,
          computations: (userData.computations as Record<string, unknown>) ?? null,
        },
      }
    },

    outputs: {
      userId: {
        type: 'string',
        description: 'External user ID',
        optional: true,
      },
      deviceId: {
        type: 'string',
        description: 'Device ID',
        optional: true,
      },
      ampProps: {
        type: 'json',
        description:
          'Amplitude user properties (library, first_used, last_used, custom properties)',
        optional: true,
      },
      cohortIds: {
        type: 'array',
        description: 'List of cohort IDs the user belongs to',
        optional: true,
        items: { type: 'string' },
      },
      computations: {
        type: 'json',
        description: 'Computed user properties',
        optional: true,
      },
    },
  }
