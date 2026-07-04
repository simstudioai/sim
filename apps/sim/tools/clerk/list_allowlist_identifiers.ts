import { createLogger } from '@sim/logger'
import type {
  ClerkAllowlistIdentifier,
  ClerkApiError,
  ClerkListAllowlistIdentifiersParams,
  ClerkListAllowlistIdentifiersResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListAllowlistIdentifiers')

export const clerkListAllowlistIdentifiersTool: ToolConfig<
  ClerkListAllowlistIdentifiersParams,
  ClerkListAllowlistIdentifiersResponse
> = {
  id: 'clerk_list_allowlist_identifiers',
  name: 'List Allowlist Identifiers from Clerk',
  description: 'List email/phone/web3-wallet identifiers on your Clerk instance allowlist',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10, 50, 100; range: 1-500, default: 10)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 10, 20)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()

      if (params.limit) queryParams.append('limit', params.limit.toString())
      if (params.offset) queryParams.append('offset', params.offset.toString())

      const queryString = queryParams.toString()
      return queryString
        ? `https://api.clerk.com/v1/allowlist_identifiers?${queryString}`
        : 'https://api.clerk.com/v1/allowlist_identifiers'
    },
    method: 'GET',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkAllowlistIdentifier[] | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to list allowlist identifiers from Clerk'
      )
    }

    const identifiers = (data as ClerkAllowlistIdentifier[]).map((identifier) => ({
      id: identifier.id,
      identifier: identifier.identifier,
      identifierType: identifier.identifier_type,
      invitationId: identifier.invitation_id ?? null,
      createdAt: identifier.created_at,
      updatedAt: identifier.updated_at,
    }))

    return {
      success: true,
      output: {
        identifiers,
        totalCount: identifiers.length,
        success: true,
      },
    }
  },

  outputs: {
    identifiers: {
      type: 'array',
      description: 'Array of Clerk allowlist identifier objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Allowlist identifier ID' },
          identifier: { type: 'string', description: 'Email, phone, or web3 wallet identifier' },
          identifierType: { type: 'string', description: 'Type of identifier' },
          invitationId: {
            type: 'string',
            description: 'Associated invitation ID',
            optional: true,
          },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of allowlist identifiers' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
