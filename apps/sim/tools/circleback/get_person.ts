import {
  type CirclebackGetPersonParams,
  type CirclebackPersonResponse,
  EXTERNAL_LINK_OUTPUT_PROPERTIES,
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

export const getPersonTool: ToolConfig<CirclebackGetPersonParams, CirclebackPersonResponse> = {
  id: 'circleback_get_person',
  name: 'Circleback Get Person',
  description:
    'Gets a person by their profile ID from Circleback, including their profile details and external links.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    profileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the person profile',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/person/${safeUrlPathSegment(params.profileId, 'profileId')}`,
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        ...mapPerson(data),
        externalLinks: mapExternalLinks(data.externalLinks),
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'The unique identifier of the person' },
    title: { type: 'string', nullable: true, description: 'The person job title' },
    companyId: {
      type: 'number',
      nullable: true,
      description: 'The unique identifier of the company the person belongs to',
    },
    companyName: {
      type: 'string',
      nullable: true,
      description: 'The name of the company the person belongs to',
    },
    email: { type: 'string', nullable: true, description: 'The person email address' },
    firstName: { type: 'string', nullable: true, description: 'The person first name' },
    lastName: { type: 'string', nullable: true, description: 'The person last name' },
    externalLinks: {
      type: 'array',
      description: 'Links to the person on external platforms and connected integrations',
      items: { type: 'object', properties: EXTERNAL_LINK_OUTPUT_PROPERTIES },
    },
  },
}
