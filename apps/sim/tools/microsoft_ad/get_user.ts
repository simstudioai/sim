import { isRecordLike } from '@sim/utils/object'
import type {
  MicrosoftAdGetUserParams,
  MicrosoftAdGetUserResponse,
} from '@/tools/microsoft_ad/types'
import { MANAGER_OUTPUT_PROPERTIES, USER_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { isTrueFlag, mapUser, USER_SELECT } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const MANAGER_SELECT = 'id,displayName,mail,userPrincipalName,jobTitle'

function mapManager(manager: unknown): Record<string, unknown> | null {
  if (!isRecordLike(manager)) return null
  return {
    id: manager.id ?? null,
    displayName: manager.displayName ?? null,
    mail: manager.mail ?? null,
    userPrincipalName: manager.userPrincipalName ?? null,
    jobTitle: manager.jobTitle ?? null,
  }
}

export const getUserTool: ToolConfig<MicrosoftAdGetUserParams, MicrosoftAdGetUserResponse> = {
  id: 'microsoft_ad_get_user',
  name: 'Get Azure AD User',
  description: 'Get a user by ID or user principal name from Azure AD',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: {
    required: true,
    provider: 'microsoft-ad',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Microsoft Graph API access token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID or user principal name (e.g., "user@example.com")',
    },
    includeManager: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Also return the user's manager (adds $expand=manager to the request)",
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      const expand = isTrueFlag(params.includeManager)
        ? `&$expand=manager($select=${MANAGER_SELECT})`
        : ''
      return `https://graph.microsoft.com/v1.0/users/${safeUrlPathSegment(userId, 'userId')}?$select=${USER_SELECT}${expand}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response, params) => {
    const user = await response.json()
    return {
      success: true,
      output: {
        user: mapUser(user),
        ...(isTrueFlag(params?.includeManager) ? { manager: mapManager(user.manager) } : {}),
      },
    }
  },
  outputs: {
    user: {
      type: 'object',
      description: 'User details',
      properties: USER_OUTPUT_PROPERTIES,
    },
    manager: {
      type: 'object',
      description:
        "The user's manager, returned only when includeManager is true; null when no manager is assigned",
      optional: true,
      properties: MANAGER_OUTPUT_PROPERTIES,
    },
  },
}
