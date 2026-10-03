import type {
  MicrosoftAdListDevicesParams,
  MicrosoftAdListDevicesResponse,
} from '@/tools/microsoft_ad/types'
import { DEVICE_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import {
  assertGraphNextPageUrlForCollection,
  buildGraphCollectionUrl,
  DEVICE_SELECT,
  graphCollectionHeaders,
  mapDevice,
  usesGraphAdvancedQuery,
} from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

export const listDevicesTool: ToolConfig<
  MicrosoftAdListDevicesParams,
  MicrosoftAdListDevicesResponse
> = {
  id: 'microsoft_ad_list_devices',
  name: 'List Microsoft Entra ID Devices',
  description: 'List the devices registered in Microsoft Entra ID',
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
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of devices to return',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `OData filter expression. Example: "accountEnabled eq false" or "operatingSystem eq 'Windows'".`,
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search string matched against the device display name',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Continuation URL from a previous response's 'nextLink' output, used to fetch the next page of results",
    },
  },
  request: {
    url: (params) => {
      if (params.nextLink) return assertGraphNextPageUrlForCollection(params.nextLink, ['devices'])
      const search = params.search?.trim()
      return buildGraphCollectionUrl('devices', {
        select: DEVICE_SELECT,
        top: params.top,
        filter: params.filter,
        search: search
          ? `"displayName:${search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
          : undefined,
        count: usesGraphAdvancedQuery(params),
      })
    },
    method: 'GET',
    headers: (params) => graphCollectionHeaders(params),
  },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    const devices = (data.value ?? []).map(mapDevice)
    return {
      success: true,
      output: {
        devices,
        deviceCount: devices.length,
        nextLink: getGraphNextPageUrl(data) ?? null,
      },
    }
  },
  outputs: {
    devices: {
      type: 'array',
      description: 'Registered devices',
      items: {
        type: 'object',
        properties: DEVICE_OUTPUT_PROPERTIES,
      },
    },
    deviceCount: { type: 'number', description: 'Number of devices returned' },
    nextLink: {
      type: 'string',
      description: 'Continuation URL for the next page of results, or null if there are no more',
      optional: true,
    },
  },
}
