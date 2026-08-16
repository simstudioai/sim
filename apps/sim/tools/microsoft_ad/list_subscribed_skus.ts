import type {
  MicrosoftAdListSubscribedSkusParams,
  MicrosoftAdListSubscribedSkusResponse,
} from '@/tools/microsoft_ad/types'
import { SUBSCRIBED_SKU_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { mapServicePlans } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'

export const listSubscribedSkusTool: ToolConfig<
  MicrosoftAdListSubscribedSkusParams,
  MicrosoftAdListSubscribedSkusResponse
> = {
  id: 'microsoft_ad_list_subscribed_skus',
  name: 'List Microsoft Entra ID Subscribed SKUs',
  description:
    'List the subscription SKUs the tenant owns, including how many license units are prepaid and how many are consumed',
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
    url: 'https://graph.microsoft.com/v1.0/subscribedSkus',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const skus = (data.value ?? []).map((sku: Record<string, unknown>) => {
      const prepaidUnits = (sku.prepaidUnits ?? null) as Record<string, unknown> | null
      return {
        id: sku.id ?? null,
        skuId: sku.skuId ?? null,
        skuPartNumber: sku.skuPartNumber ?? null,
        appliesTo: sku.appliesTo ?? null,
        capabilityStatus: sku.capabilityStatus ?? null,
        consumedUnits: sku.consumedUnits ?? null,
        prepaidUnits: {
          enabled: prepaidUnits?.enabled ?? null,
          suspended: prepaidUnits?.suspended ?? null,
          warning: prepaidUnits?.warning ?? null,
          lockedOut: prepaidUnits?.lockedOut ?? null,
        },
        servicePlans: mapServicePlans(sku.servicePlans),
      }
    })
    return {
      success: true,
      output: {
        skus,
        skuCount: skus.length,
      },
    }
  },
  outputs: {
    skus: {
      type: 'array',
      description: 'Subscription SKUs owned by the tenant',
      items: {
        type: 'object',
        properties: SUBSCRIBED_SKU_OUTPUT_PROPERTIES,
      },
    },
    skuCount: { type: 'number', description: 'Number of SKUs returned' },
  },
}
