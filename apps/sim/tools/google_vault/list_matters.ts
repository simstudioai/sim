import type { GoogleVaultListMattersParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listMattersTool: ToolConfig<GoogleVaultListMattersParams> = {
  id: 'google_vault_list_matters',
  name: 'Vault List Matters',
  description: 'List matters, or get a specific matter if matterId is provided',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of matters to return per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination (nextPageToken from a previous response)',
    },
    matterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional matter ID to fetch a specific matter (e.g., "12345678901234567890")',
    },
    view: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amount of detail to return: BASIC (ID, name, description, state; the default) or FULL (also includes matterPermissions, the owners and collaborators)',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only list matters in this state: OPEN, CLOSED, or DELETED (default lists all states; ignored when matterId is provided)',
    },
  },

  request: {
    url: (params) => {
      if (params.matterId) {
        const url = new URL(
          `https://vault.googleapis.com/v1/matters/${safeUrlPathSegment(params.matterId, 'matterId')}`
        )
        if (params.view) url.searchParams.set('view', params.view)
        return url.toString()
      }
      const url = new URL('https://vault.googleapis.com/v1/matters')
      if (params.view) url.searchParams.set('view', params.view)
      if (params.state) url.searchParams.set('state', params.state)
      if (params.pageSize !== undefined && params.pageSize !== null) {
        const pageSize = Number(params.pageSize)
        if (Number.isFinite(pageSize) && pageSize > 0) {
          url.searchParams.set('pageSize', String(pageSize))
        }
      }
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response, params?: GoogleVaultListMattersParams) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list matters'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    if (params?.matterId) {
      return { success: true, output: { matter: data } }
    }
    return { success: true, output: data }
  },

  outputs: {
    matters: {
      type: 'json',
      description:
        'Array of matter objects (matterId, name, description, state; matterPermissions when view is FULL)',
    },
    matter: {
      type: 'json',
      description:
        'Single matter object (when matterId is provided): matterId, name, description, state; matterPermissions when view is FULL',
    },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
