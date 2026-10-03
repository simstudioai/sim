import type {
  MicrosoftAdListUserLicensesParams,
  MicrosoftAdListUserLicensesResponse,
} from '@/tools/microsoft_ad/types'
import { LICENSE_DETAIL_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { mapServicePlans } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'

export const listUserLicensesTool: ToolConfig<
  MicrosoftAdListUserLicensesParams,
  MicrosoftAdListUserLicensesResponse
> = {
  id: 'microsoft_ad_list_user_licenses',
  name: 'List Microsoft Entra ID User Licenses',
  description: 'List the subscription licenses assigned to a user in Microsoft Entra ID',
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
      description: 'User ID or user principal name',
    },
  },
  request: {
    url: (params) => {
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/licenseDetails`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const licenses = (data.value ?? []).map((license: Record<string, unknown>) => ({
      id: license.id ?? null,
      skuId: license.skuId ?? null,
      skuPartNumber: license.skuPartNumber ?? null,
      servicePlans: mapServicePlans(license.servicePlans),
    }))
    return {
      success: true,
      output: {
        licenses,
        licenseCount: licenses.length,
      },
    }
  },
  outputs: {
    licenses: {
      type: 'array',
      description: 'Licenses assigned to the user',
      items: {
        type: 'object',
        properties: LICENSE_DETAIL_OUTPUT_PROPERTIES,
      },
    },
    licenseCount: { type: 'number', description: 'Number of licenses returned' },
  },
}
