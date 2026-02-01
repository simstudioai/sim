import type { EnrichSearchLogoParams, EnrichSearchLogoResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchLogoTool: ToolConfig<EnrichSearchLogoParams, EnrichSearchLogoResponse> = {
  id: 'enrich_search_logo',
  name: 'Enrich Search Logo',
  description: 'Get a company logo image URL by domain.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., google.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/search-logo')
      url.searchParams.append('url', params.url.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    // Check if response is JSON (error case) or binary (success case)
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      // API returned JSON, likely an error or no logo found
      const data = await response.json()
      return {
        success: true,
        output: {
          logoUrl: data.logo_url ?? data.logoUrl ?? null,
          domain: params?.url ?? '',
        },
      }
    }

    // API returns the image directly, construct the URL for access
    const logoUrl = `https://api.enrich.so/v1/api/search-logo?url=${encodeURIComponent(params?.url ?? '')}`

    return {
      success: true,
      output: {
        logoUrl,
        domain: params?.url ?? '',
      },
    }
  },

  outputs: {
    logoUrl: {
      type: 'string',
      description: 'URL to fetch the company logo',
      optional: true,
    },
    domain: {
      type: 'string',
      description: 'Domain that was looked up',
    },
  },
}
