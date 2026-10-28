import type {
  IntuneGetCompliancePolicyParams,
  IntuneGetCompliancePolicyResponse,
} from '@/tools/intune/types'
import { INTUNE_POLICY_PROPERTIES } from '@/tools/intune/types'
import {
  buildIntuneResourcePath,
  buildIntuneResourceUrl,
  INTUNE_AUTH_PARAMS,
  intuneHeaders,
  mapIntunePolicy,
  readIntuneEntity,
} from '@/tools/intune/utils'
import type { ToolConfig } from '@/tools/types'

export const intuneGetCompliancePolicyTool: ToolConfig<
  IntuneGetCompliancePolicyParams,
  IntuneGetCompliancePolicyResponse
> = {
  id: 'intune_get_compliance_policy',
  name: 'Microsoft Intune Get Compliance Policy',
  description: 'Read common metadata for an Intune compliance policy',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-intune' },
  params: {
    ...INTUNE_AUTH_PARAMS,
    compliancePolicyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Device compliance policy ID',
    },
  },
  request: {
    url: (params) =>
      buildIntuneResourceUrl(
        buildIntuneResourcePath('deviceCompliancePolicies', params.compliancePolicyId)
      ),
    method: 'GET',
    headers: intuneHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, _params, context) => {
    return {
      success: true,
      output: { policy: await readIntuneEntity(response, mapIntunePolicy, context) },
    }
  },
  outputs: {
    policy: {
      type: 'json',
      description: 'Get Compliance Policy',
      properties: INTUNE_POLICY_PROPERTIES,
    },
  },
}
