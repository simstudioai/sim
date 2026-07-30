import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkDeleteBlocklistIdentifierParams,
  ClerkDeleteBlocklistIdentifierResponse,
  ClerkDeleteResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkDeleteBlocklistIdentifier')

export const clerkDeleteBlocklistIdentifierTool: ToolConfig<
  ClerkDeleteBlocklistIdentifierParams,
  ClerkDeleteBlocklistIdentifierResponse
> = {
  id: 'clerk_delete_blocklist_identifier',
  name: 'Delete Blocklist Identifier from Clerk',
  description: 'Remove an identifier from your Clerk instance blocklist',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    identifierId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the blocklist identifier to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.clerk.com/v1/blocklist_identifiers/${params.identifierId?.trim()}`,
    method: 'DELETE',
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
    const data: ClerkDeleteResponse | ClerkApiError = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(
        (data as ClerkApiError).errors?.[0]?.message ||
          'Failed to delete blocklist identifier from Clerk'
      )
    }

    const deleteData = data as ClerkDeleteResponse
    return {
      success: true,
      output: {
        id: deleteData.id,
        object: deleteData.object ?? 'blocklist_identifier',
        deleted: deleteData.deleted ?? true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted blocklist identifier ID' },
    object: { type: 'string', description: 'Object type (blocklist_identifier)' },
    deleted: { type: 'boolean', description: 'Whether the identifier was deleted' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
