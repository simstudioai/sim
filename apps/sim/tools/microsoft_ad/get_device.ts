import type {
  MicrosoftAdGetDeviceParams,
  MicrosoftAdGetDeviceResponse,
} from '@/tools/microsoft_ad/types'
import { DEVICE_OUTPUT_PROPERTIES } from '@/tools/microsoft_ad/types'
import { DEVICE_SELECT, mapDevice } from '@/tools/microsoft_ad/utils'
import type { ToolConfig } from '@/tools/types'

export const getDeviceTool: ToolConfig<MicrosoftAdGetDeviceParams, MicrosoftAdGetDeviceResponse> = {
  id: 'microsoft_ad_get_device',
  name: 'Get Microsoft Entra ID Device',
  description: 'Get a registered device by its object ID from Microsoft Entra ID',
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
    deviceObjectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device object ID (the "id" field), not the "deviceId" registration identifier',
    },
  },
  request: {
    url: (params) => {
      const deviceObjectId = params.deviceObjectId?.trim()
      if (!deviceObjectId) throw new Error('Device object ID is required')
      return `https://graph.microsoft.com/v1.0/devices/${encodeURIComponent(deviceObjectId)}?$select=${DEVICE_SELECT}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    const device = await response.json()
    return {
      success: true,
      output: {
        device: mapDevice(device),
      },
    }
  },
  outputs: {
    device: {
      type: 'object',
      description: 'Device details',
      properties: DEVICE_OUTPUT_PROPERTIES,
    },
  },
}
