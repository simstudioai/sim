import type {
  IntuneListDeviceConfigurationsParams,
  IntuneListDeviceConfigurationsResponse,
} from '@/tools/intune/types'
import { INTUNE_NEXT_LINK_OUTPUT, INTUNE_POLICY_PROPERTIES } from '@/tools/intune/types'
import {
  buildIntuneCollectionUrl,
  INTUNE_AUTH_PARAMS,
  INTUNE_PAGE_PARAMS,
  intuneHeaders,
  mapIntunePolicy,
  readIntunePage,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneListDeviceConfigurationsTool: ToolConfig<
  IntuneListDeviceConfigurationsParams,
  IntuneListDeviceConfigurationsResponse
> = {
  id: 'intune_list_device_configurations',
  name: 'Microsoft Intune List Device Configurations',
  description: 'Read one page of device configurations from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    ...INTUNE_PAGE_PARAMS,
  },
  request: {
    url: (params) => buildIntuneCollectionUrl('deviceConfigurations', params),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    const page = await readIntunePage(response, 'deviceConfigurations', mapIntunePolicy, context)
    return { success: true, output: { configurations: page.items, nextLink: page.nextLink } }
  },
  outputs: {
    configurations: {
      type: 'array',
      description: 'List Device Configurations',
      items: { type: 'object', properties: INTUNE_POLICY_PROPERTIES },
    },
    nextLink: INTUNE_NEXT_LINK_OUTPUT,
  },
}
