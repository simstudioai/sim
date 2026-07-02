import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkBlocklistIdentifier,
  ClerkListBlocklistIdentifiersParams,
  ClerkListBlocklistIdentifiersResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkListBlocklistIdentifiers')

export const clerkListBlocklistIdentifiersTool: ToolConfig<
  ClerkListBlocklistIdentifiersParams,
  ClerkListBlocklistIdentifiersResponse
> = {
  id: 'clerk_list_blocklist_identifiers',
  name: 'List Blocklist Identifiers from Clerk',
  description: 'List email/phone/web3-wallet identifiers on your Clerk instance blocklist',
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
        ? `https://api.clerk.com/v1/blocklist_identifiers?${queryString}`
        : 'https://api.clerk.com/v1/blocklist_identifiers'
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
    const json: { data: ClerkBlocklistIdentifier[]; total_count: number } | ClerkApiError =
      await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data: json, status: response.status })
      throw new Error(
        (json as ClerkApiError).errors?.[0]?.message ||
          'Failed to list blocklist identifiers from Clerk'
      )
    }

    const responseData = json as { data: ClerkBlocklistIdentifier[]; total_count: number }

    const identifiers = responseData.data.map((identifier) => ({
      id: identifier.id,
      identifier: identifier.identifier,
      identifierType: identifier.identifier_type,
      createdAt: identifier.created_at,
      updatedAt: identifier.updated_at,
    }))

    return {
      success: true,
      output: {
        identifiers,
        totalCount: responseData.total_count ?? identifiers.length,
        success: true,
      },
    }
  },

  outputs: {
    identifiers: {
      type: 'array',
      description: 'Array of Clerk blocklist identifier objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Blocklist identifier ID' },
          identifier: { type: 'string', description: 'Email, phone, or web3 wallet identifier' },
          identifierType: { type: 'string', description: 'Type of identifier' },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last update timestamp' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of blocklist identifiers' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
