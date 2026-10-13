import type { IntuneListDevicesParams, IntuneListDevicesResponse } from '@/tools/intune/types'
import { INTUNE_MANAGED_DEVICE_PROPERTIES, INTUNE_NEXT_LINK_OUTPUT } from '@/tools/intune/types'
import {
  buildIntuneCollectionUrl,
  INTUNE_AUTH_PARAMS,
  INTUNE_PAGE_PARAMS,
  intuneHeaders,
  mapIntuneManagedDevice,
  readIntunePage,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneListDevicesTool: ToolConfig<IntuneListDevicesParams, IntuneListDevicesResponse> =
  {
    id: 'intune_list_devices',
    name: 'Microsoft Intune List Devices',
    description: 'Read one page of devices from Microsoft Intune',
    version: '1.0.0',
    oauth: { required: true, provider: 'microsoft-intune' },
    params: {
      ...INTUNE_AUTH_PARAMS,
      ...INTUNE_PAGE_PARAMS,
      filter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          "OData filter, for example complianceState eq 'noncompliant'; ignored with nextLink",
      },
    },
    request: {
      url: (params) => buildIntuneCollectionUrl('managedDevices', params),
      method: 'GET',
      headers: intuneHeaders,
      redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    },
    transformResponse: async (response, _params, context) => {
      const page = await readIntunePage(response, 'managedDevices', mapIntuneManagedDevice, context)
      return { success: true, output: { devices: page.items, nextLink: page.nextLink } }
    },
    outputs: {
      devices: {
        type: 'array',
        description: 'List Devices',
        items: { type: 'object', properties: INTUNE_MANAGED_DEVICE_PROPERTIES },
      },
      nextLink: INTUNE_NEXT_LINK_OUTPUT,
    },
  }
