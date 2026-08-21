import type {
  AffinityCurrentUserResponse,
  AffinityGetCurrentUserParams,
} from '@/tools/affinity/types'
import {
  affinityError,
  affinityHeaders,
  buildAffinityUrl,
  readAffinityJson,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetCurrentUserTool: ToolConfig<
  AffinityGetCurrentUserParams,
  AffinityCurrentUserResponse
> = {
  id: 'affinity_get_current_user',
  name: 'Affinity Get Current User',
  description:
    'Verify an Affinity API key and return the tenant, the user behind the key, and the scopes the grant carries.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
  },

  request: {
    url: () => buildAffinityUrl('/auth/whoami'),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    if (!response.ok) throw await affinityError(response)
    const data = await readAffinityJson<AffinityCurrentUserResponse['output']>(response)
    return {
      success: true,
      output: { tenant: data.tenant, user: data.user, grant: data.grant },
    }
  },

  outputs: {
    tenant: {
      type: 'object',
      description: 'The Affinity organization the key belongs to',
      properties: {
        id: { type: 'number', description: "The tenant's unique identifier" },
        name: { type: 'string', description: 'The organization name' },
        subdomain: { type: 'string', description: 'The subdomain under affinity.co' },
      },
    },
    user: {
      type: 'object',
      description: 'The user the key authenticates as',
      properties: {
        id: { type: 'number', description: "The user's unique identifier" },
        firstName: { type: 'string', description: "The user's first name" },
        lastName: { type: 'string', nullable: true, description: "The user's last name" },
        emailAddress: { type: 'string', description: "The user's email address" },
      },
    },
    grant: {
      type: 'object',
      description: 'How the request is authenticated and what it may reach',
      properties: {
        type: { type: 'string', description: 'api-key or access-token' },
        scopes: { type: 'array', description: 'Scopes available to the grant' },
        createdAt: { type: 'string', description: 'When the grant was created' },
      },
    },
  },
}
