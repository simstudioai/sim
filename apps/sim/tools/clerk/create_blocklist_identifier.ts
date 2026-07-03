import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkBlocklistIdentifier,
  ClerkCreateBlocklistIdentifierParams,
  ClerkCreateBlocklistIdentifierResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateBlocklistIdentifier')

export const clerkCreateBlocklistIdentifierTool: ToolConfig<
  ClerkCreateBlocklistIdentifierParams,
  ClerkCreateBlocklistIdentifierResponse
> = {
  id: 'clerk_create_blocklist_identifier',
  name: 'Create Blocklist Identifier in Clerk',
  description:
    'Add an email, phone number, or web3 wallet to your Clerk instance blocklist to prevent sign-ups',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address, phone number, or web3 wallet to block',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/blocklist_identifiers',
    method: 'POST',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => ({
      identifier: params.identifier?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data: ClerkBlocklistIdentifier | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to create blocklist identifier in Clerk'
      )
    }

    const identifier = data as ClerkBlocklistIdentifier
    return {
      success: true,
      output: {
        id: identifier.id,
        identifier: identifier.identifier,
        identifierType: identifier.identifier_type,
        createdAt: identifier.created_at,
        updatedAt: identifier.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Blocklist identifier ID' },
    identifier: { type: 'string', description: 'Email, phone, or web3 wallet identifier' },
    identifierType: { type: 'string', description: 'Type of identifier' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
