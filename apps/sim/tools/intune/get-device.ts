import type { IntuneGetDeviceParams, IntuneGetDeviceResponse } from '@/tools/intune/types'
import { INTUNE_MANAGED_DEVICE_PROPERTIES } from '@/tools/intune/types'
import {
  buildIntuneResourcePath,
  buildIntuneResourceUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  mapIntuneManagedDevice,
  readIntuneEntity,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneGetDeviceTool: ToolConfig<IntuneGetDeviceParams, IntuneGetDeviceResponse> = {
  id: 'intune_get_device',
  name: 'Microsoft Intune Get Device',
  description: 'Read device details from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    managedDeviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Intune managed device ID (not the Microsoft Entra device ID)',
    },
  },
  request: {
    url: (params) =>
      buildIntuneResourceUrl(buildIntuneResourcePath('managedDevices', params.managedDeviceId)),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    return {
      success: true,
      output: { device: await readIntuneEntity(response, mapIntuneManagedDevice, context) },
    }
  },
  outputs: {
    device: {
      type: 'json',
      description: 'Get Device',
      properties: INTUNE_MANAGED_DEVICE_PROPERTIES,
    },
  },
}
