import type {
  MicrosoftAdAssignLicenseParams,
  MicrosoftAdAssignLicenseResponse,
} from '@/tools/microsoft_ad/types'
import { ASSIGNED_LICENSE_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { parseIdList } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'

export const assignLicenseTool: ToolConfig<
  MicrosoftAdAssignLicenseParams,
  MicrosoftAdAssignLicenseResponse
> = {
  id: 'microsoft_ad_assign_license',
  name: 'Assign Microsoft Entra ID License',
  description:
    'Add or remove subscription licenses (SKUs) on a user in Microsoft Entra ID. Removing a license immediately revokes the access it granted to the associated services.',
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
      description: 'User ID or user principal name to change licenses for',
    },
    addSkuIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated SKU IDs (GUIDs) of the licenses to assign. Leave empty to only remove licenses.',
    },
    removeSkuIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated SKU IDs (GUIDs) of the licenses to remove. Leave empty to only add licenses.',
    },
    disabledPlanIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated service plan IDs (GUIDs) to disable on every license being assigned',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/assignLicense`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const addSkuIds = parseIdList(params.addSkuIds)
      const removeLicenses = parseIdList(params.removeSkuIds)
      if (addSkuIds.length === 0 && removeLicenses.length === 0) {
        throw new Error('Provide at least one SKU ID to add or remove')
      }
      const disabledPlans = parseIdList(params.disabledPlanIds)
      return {
        addLicenses: addSkuIds.map((skuId) => ({ skuId, disabledPlans })),
        removeLicenses,
      }
    },
  },
  transformResponse: async (response: Response) => {
    const user = await response.json()
    return {
      success: true,
      output: {
        userId: user.id ?? null,
        displayName: user.displayName ?? null,
        userPrincipalName: user.userPrincipalName ?? null,
        assignedLicenses: (user.assignedLicenses ?? []).map((license: Record<string, unknown>) => ({
          skuId: license.skuId ?? null,
          disabledPlans: license.disabledPlans ?? [],
        })),
      },
    }
  },
  outputs: {
    userId: { type: 'string', description: 'ID of the user whose licenses changed' },
    displayName: { type: 'string', description: 'Display name of the user' },
    userPrincipalName: { type: 'string', description: 'User principal name of the user' },
    assignedLicenses: {
      type: 'array',
      description: 'Licenses assigned to the user after the change',
      items: {
        type: 'object',
        properties: ASSIGNED_LICENSE_OUTPUT_PROPERTIES,
      },
    },
  },
}
