import { createLogger } from '@sim/logger'
import type {
  ClerkAllowlistIdentifier,
  ClerkApiError,
  ClerkCreateAllowlistIdentifierParams,
  ClerkCreateAllowlistIdentifierResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkCreateAllowlistIdentifier')

export const clerkCreateAllowlistIdentifierTool: ToolConfig<
  ClerkCreateAllowlistIdentifierParams,
  ClerkCreateAllowlistIdentifierResponse
> = {
  id: 'clerk_create_allowlist_identifier',
  name: 'Create Allowlist Identifier in Clerk',
  description: 'Add an email, phone number, or web3 wallet to your Clerk instance allowlist',
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
      description:
        'Email address, phone number, or web3 wallet to allow (wildcards like *@example.com supported for email)',
    },
    notify: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to notify the identifier owner by email (default false)',
    },
  },

  request: {
    url: () => 'https://api.clerk.com/v1/allowlist_identifiers',
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
    body: (params) => {
      const body: Record<string, unknown> = {
        identifier: params.identifier?.trim(),
      }

      if (params.notify !== undefined) body.notify = params.notify

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data: ClerkAllowlistIdentifier | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to create allowlist identifier in Clerk'
      )
    }

    const identifier = data as ClerkAllowlistIdentifier
    return {
      success: true,
      output: {
        id: identifier.id,
        identifier: identifier.identifier,
        identifierType: identifier.identifier_type,
        invitationId: identifier.invitation_id ?? null,
        createdAt: identifier.created_at,
        updatedAt: identifier.updated_at,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Allowlist identifier ID' },
    identifier: { type: 'string', description: 'Email, phone, or web3 wallet identifier' },
    identifierType: { type: 'string', description: 'Type of identifier' },
    invitationId: { type: 'string', description: 'Associated invitation ID', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last update timestamp' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
