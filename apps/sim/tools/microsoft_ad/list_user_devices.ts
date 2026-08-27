import type {
  MicrosoftAdListDevicesResponse,
  MicrosoftAdListUserDevicesParams,
} from '@/tools/microsoft_ad/types'
import { DEVICE_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { assertGraphNextPageUrlForCollection, mapDevice } from '@/tools/microsoft_ad/utils'
import { getGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

const RELATIONSHIP_PATHS: Record<string, string> = {
  registered: 'registeredDevices',
  owned: 'ownedDevices',
}

export const listUserDevicesTool: ToolConfig<
  MicrosoftAdListUserDevicesParams,
  MicrosoftAdListDevicesResponse
> = {
  id: 'microsoft_ad_list_user_devices',
  name: 'List Microsoft Entra ID User Devices',
  description:
    'List the devices a user has registered or owns. Devices the caller cannot read are returned with only their ID and the remaining fields null.',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID or user principal name. Not needed when Next Page is provided to fetch a later page.',
    },
    deviceRelationship: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which devices to list: "registered" for devices the user registered, or "owned" for devices the user owns. Defaults to "registered".',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of devices to return',
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
      const relationship = params.deviceRelationship?.trim() || 'registered'
      const path = RELATIONSHIP_PATHS[relationship]
      if (!path) throw new Error('Device relationship must be "registered" or "owned"')
      /**
       * Assert against the currently selected relationship only. Accepting both would let a
       * continuation URL for `registeredDevices` keep paging that collection after the Device
       * Link dropdown was flipped to `ownedDevices`, silently returning the other relationship.
       */
      if (params.nextLink) return assertGraphNextPageUrlForCollection(params.nextLink, [path])
      const userId = params.userId?.trim()
      if (!userId) throw new Error('User ID is required')
      const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/${path}`
      return params.top ? `${base}?$top=${params.top}` : base
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
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
      description: 'Devices linked to the user',
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
