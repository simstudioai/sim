import type {
  IntuneListCompliancePolicyDeviceStatusesParams,
  IntuneListCompliancePolicyDeviceStatusesResponse,
} from '@/tools/intune/types'
import { INTUNE_DEVICE_STATUS_PROPERTIES, INTUNE_NEXT_LINK_OUTPUT } from '@/tools/intune/types'
import {
  buildIntuneCollectionUrl,
  buildIntuneResourcePath,
  INTUNE_AUTH_PARAMS,
  INTUNE_PAGE_PARAMS,
  intuneHeaders,
  mapIntuneDeviceStatus,
  readIntunePage,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneListCompliancePolicyDeviceStatusesTool: ToolConfig<
  IntuneListCompliancePolicyDeviceStatusesParams,
  IntuneListCompliancePolicyDeviceStatusesResponse
> = {
  id: 'intune_list_compliance_policy_device_statuses',
  name: 'Microsoft Intune List Compliance Policy Device Statuses',
  description: 'Read one page of compliance policy device statuses from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    ...INTUNE_PAGE_PARAMS,
    compliancePolicyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device compliance policy ID',
    },
  },
  request: {
    url: (params) =>
      buildIntuneCollectionUrl(
        buildIntuneResourcePath(
          'deviceCompliancePolicies',
          params.compliancePolicyId,
          'deviceStatuses'
        ),
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
      buildIntuneResourcePath(
        'deviceCompliancePolicies',
        params.compliancePolicyId,
        'deviceStatuses'
      ),
      mapIntuneDeviceStatus,
      context
    )
    return { success: true, output: { deviceStatuses: page.items, nextLink: page.nextLink } }
  },
  outputs: {
    deviceStatuses: {
      type: 'array',
      description: 'List Compliance Policy Device Statuses',
      items: { type: 'object', properties: INTUNE_DEVICE_STATUS_PROPERTIES },
    },
    nextLink: INTUNE_NEXT_LINK_OUTPUT,
  },
}
