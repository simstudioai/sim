import { createLogger } from '@sim/logger'
import type {
  ClerkApiError,
  ClerkDeleteOrganizationParams,
  ClerkDeleteOrganizationResponse,
  ClerkDeleteResponse,
} from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkDeleteOrganization')

export const clerkDeleteOrganizationTool: ToolConfig<
  ClerkDeleteOrganizationParams,
  ClerkDeleteOrganizationResponse
> = {
  id: 'clerk_delete_organization',
  name: 'Delete Organization from Clerk',
  description: 'Delete an organization from your Clerk application',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the organization to delete (e.g., org_2NNEqL2nrIRdJ194ndJqAHwEfxC)',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/organizations/${params.organizationId?.trim()}`,
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
        (data as ClerkApiError).errors?.[0]?.message || 'Failed to delete organization from Clerk'
      )
    }

    const deleteData = data as ClerkDeleteResponse
    return {
      success: true,
      output: {
        id: deleteData.id,
        object: deleteData.object ?? 'organization',
        deleted: deleteData.deleted ?? true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted organization ID' },
    object: { type: 'string', description: 'Object type (organization)' },
    deleted: { type: 'boolean', description: 'Whether the organization was deleted' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
