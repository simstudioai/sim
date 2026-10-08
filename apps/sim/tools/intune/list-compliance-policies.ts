import type {
  IntuneListCompliancePoliciesParams,
  IntuneListCompliancePoliciesResponse,
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

export const intuneListCompliancePoliciesTool: ToolConfig<
  IntuneListCompliancePoliciesParams,
  IntuneListCompliancePoliciesResponse
> = {
  id: 'intune_list_compliance_policies',
  name: 'Microsoft Intune List Compliance Policies',
  description: 'Read one page of compliance policies from Microsoft Intune',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    ...INTUNE_PAGE_PARAMS,
  },
  request: {
    url: (params) => buildIntuneCollectionUrl('deviceCompliancePolicies', params),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    const page = await readIntunePage(
      response,
      'deviceCompliancePolicies',
      mapIntunePolicy,
      context
    )
    return { success: true, output: { policies: page.items, nextLink: page.nextLink } }
  },
  outputs: {
    policies: {
      type: 'array',
      description: 'List Compliance Policies',
      items: { type: 'object', properties: INTUNE_POLICY_PROPERTIES },
    },
    nextLink: INTUNE_NEXT_LINK_OUTPUT,
  },
}
