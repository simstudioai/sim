import type { EnrichPhoneFinderParams, EnrichPhoneFinderResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const phoneFinderTool: ToolConfig<EnrichPhoneFinderParams, EnrichPhoneFinderResponse> = {
  id: 'enrich_phone_finder',
  name: 'Enrich Phone Finder',
  description: 'Find a phone number from a LinkedIn profile URL.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    linkedinProfile: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL (e.g., linkedin.com/in/williamhgates)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/mobile-finder')
      url.searchParams.append('linkedin_profile', params.linkedinProfile.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Handle queued response (202)
    if (data.message?.includes('queued')) {
      return {
        success: true,
        output: {
          profileUrl: null,
          mobileNumber: null,
          found: false,
          status: 'in_progress',
        },
      }
    }

    return {
      success: true,
      output: {
        profileUrl: data.data?.profile_url ?? null,
        mobileNumber: data.data?.mobile_number ?? null,
        found: !!data.data?.mobile_number,
        status: 'completed',
      },
    }
  },

  outputs: {
    profileUrl: {
      type: 'string',
      description: 'LinkedIn profile URL',
      optional: true,
    },
    mobileNumber: {
      type: 'string',
      description: 'Found mobile phone number',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether a phone number was found',
    },
    status: {
      type: 'string',
      description: 'Request status (in_progress or completed)',
      optional: true,
    },
  },
}
