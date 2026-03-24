import type {
  MicrosoftAdCreateGroupParams,
  MicrosoftAdCreateGroupResponse,
} from '@/tools/microsoft_ad/types'
import { GROUP_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const createGroupTool: ToolConfig<
  MicrosoftAdCreateGroupParams,
  MicrosoftAdCreateGroupResponse
> = {
  id: 'microsoft_ad_create_group',
  name: 'Create Azure AD Group',
  description: 'Create a new group in Azure AD (Microsoft Entra ID)',
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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name for the group',
    },
    mailNickname: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mail alias for the group (ASCII only, max 64 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group description',
    },
    mailEnabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether mail is enabled (true for Microsoft 365 groups)',
    },
    securityEnabled: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether security is enabled (true for security groups)',
    },
    groupTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group type: "Unified" for Microsoft 365 group, leave empty for security group',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group visibility: "Private" or "Public"',
    },
  },
  request: {
    url: 'https://graph.microsoft.com/v1.0/groups',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        displayName: params.displayName,
        mailNickname: params.mailNickname,
        mailEnabled: params.mailEnabled,
        securityEnabled: params.securityEnabled,
      }
      if (params.description) body.description = params.description
      if (params.groupTypes) body.groupTypes = [params.groupTypes]
      else body.groupTypes = []
      if (params.visibility) body.visibility = params.visibility
      return body
    },
  },
  transformResponse: async (response: Response) => {
    const group = await response.json()
    return {
      success: true,
      output: {
        group: {
          id: group.id ?? null,
          displayName: group.displayName ?? null,
          description: group.description ?? null,
          mail: group.mail ?? null,
          mailEnabled: group.mailEnabled ?? null,
          mailNickname: group.mailNickname ?? null,
          securityEnabled: group.securityEnabled ?? null,
          groupTypes: group.groupTypes ?? [],
          visibility: group.visibility ?? null,
          createdDateTime: group.createdDateTime ?? null,
        },
      },
    }
  },
  outputs: {
    group: {
      type: 'object',
      description: 'Created group details',
      properties: GROUP_OUTPUT_PROPERTIES,
    },
  },
}
