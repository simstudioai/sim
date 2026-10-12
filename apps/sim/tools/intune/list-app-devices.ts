import type { IntuneListAppDevicesParams, IntuneListAppDevicesResponse } from '@/tools/intune/types'
import { INTUNE_MANAGED_DEVICE_PROPERTIES, INTUNE_NEXT_LINK_OUTPUT } from '@/tools/intune/types'
import {
  buildIntuneCollectionUrl,
  buildIntuneResourcePath,
  INTUNE_AUTH_PARAMS,
  INTUNE_PAGE_PARAMS,
  intuneHeaders,
  mapIntuneManagedDevice,
  readIntunePage,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneListAppDevicesTool: ToolConfig<
  IntuneListAppDevicesParams,
  IntuneListAppDevicesResponse
> = {
  id: 'intune_list_app_devices',
  name: 'Microsoft Intune List App Devices',
  description: 'Read one page of managed devices that have a detected application installed',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    ...INTUNE_PAGE_PARAMS,
    detectedAppId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Detected application ID',
    },
  },
  request: {
    url: (params) =>
      buildIntuneCollectionUrl(
        buildIntuneResourcePath('detectedApps', params.detectedAppId, 'managedDevices'),
        params
      ),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, params, context) => {
    if (!params) throw new Error('Microsoft Intune request parameters are required')
    const page = await readIntunePage(
      response,
      buildIntuneResourcePath('detectedApps', params.detectedAppId, 'managedDevices'),
      mapIntuneManagedDevice,
      context
    )
    return { success: true, output: { devices: page.items, nextLink: page.nextLink } }
  },
  outputs: {
    devices: {
      type: 'array',
      description: 'List App Devices',
      items: { type: 'object', properties: INTUNE_MANAGED_DEVICE_PROPERTIES },
    },
    nextLink: INTUNE_NEXT_LINK_OUTPUT,
  },
}
