import type {
  MicrosoftAdListDirectoryRolesParams,
  MicrosoftAdListDirectoryRolesResponse,
} from '@/tools/microsoft_ad/types'
import { DIRECTORY_ROLE_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import type { ToolConfig } from '@/tools/types'

export const listDirectoryRolesTool: ToolConfig<
  MicrosoftAdListDirectoryRolesParams,
  MicrosoftAdListDirectoryRolesResponse
> = {
  id: 'microsoft_ad_list_directory_roles',
  name: 'List Microsoft Entra ID Directory Roles',
  description:
    'List the administrator roles that are activated in the tenant, such as Global Administrator and User Administrator. Roles that have never been activated are not returned.',
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
  },
  request: {
    url: 'https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,description,roleTemplateId',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const roles = (data.value ?? []).map((role: Record<string, unknown>) => ({
      id: role.id ?? null,
      displayName: role.displayName ?? null,
      description: role.description ?? null,
      roleTemplateId: role.roleTemplateId ?? null,
    }))
    return {
      success: true,
      output: {
        roles,
        roleCount: roles.length,
      },
    }
  },
  outputs: {
    roles: {
      type: 'array',
      description: 'Activated directory roles',
      items: {
        type: 'object',
        properties: DIRECTORY_ROLE_OUTPUT_PROPERTIES,
      },
    },
    roleCount: { type: 'number', description: 'Number of directory roles returned' },
  },
}
