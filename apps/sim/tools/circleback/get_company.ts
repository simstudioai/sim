import {
  type CirclebackCompanyResponse,
  type CirclebackGetCompanyParams,
  EXTERNAL_LINK_OUTPUT_PROPERTIES,
  PERSON_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapExternalLinks,
  mapPerson,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getCompanyTool: ToolConfig<CirclebackGetCompanyParams, CirclebackCompanyResponse> = {
  id: 'circleback_get_company',
  name: 'Circleback Get Company',
  description:
    'Gets a company by its domain from Circleback, including its people and external links.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The website domain of the company to fetch, such as example.com',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/company/${safeUrlPathSegment(params.domain, 'domain')}`,
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        name: data.name ?? null,
        avatarUrl: data.avatarUrl ?? null,
        domain: data.domain ?? '',
        externalLinks: mapExternalLinks(data.externalLinks),
        people: (data.people ?? []).map(mapPerson),
      },
    }
  },

  outputs: {
    name: { type: 'string', nullable: true, description: 'The company name' },
    avatarUrl: {
      type: 'string',
      nullable: true,
      description: 'The URL of the company logo image',
    },
    domain: { type: 'string', description: 'The company website domain' },
    externalLinks: {
      type: 'array',
      description: 'Links to the company on external platforms and connected integrations',
      items: { type: 'object', properties: EXTERNAL_LINK_OUTPUT_PROPERTIES },
    },
    people: {
      type: 'array',
      description: 'People at the company the authenticated user has met with',
      items: { type: 'object', properties: PERSON_OUTPUT_PROPERTIES },
    },
  },
}
