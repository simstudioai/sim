import type { NetSuiteResponse, NetSuiteSystemParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest, netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetGovernanceLimitsTool: ToolConfig<NetSuiteSystemParams, NetSuiteResponse> = {
  id: 'netsuite_get_governance_limits',
  name: 'NetSuite Get Governance Limits',
  description:
    'Retrieve REST web-services concurrency limits for the NetSuite account and integration; NetSuite requires an Administrator role.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: '/services/rest/system/v1/governanceLimits',
        success: { status: 200, body: 'object', validator: 'governance-limits' },
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'Documented NetSuite governance limits',
      nullable: true,
      properties: {
        accountConcurrencyLimit: { type: 'number', description: 'Account concurrency limit' },
        accountUnallocatedConcurrencyLimit: {
          type: 'number',
          description: 'Account concurrency not allocated to integrations',
        },
        integrationConcurrencyLimit: {
          type: 'number',
          description: 'Concurrency allocated to this integration',
          optional: true,
        },
        integrationLimitType: {
          type: 'string',
          description: 'Limit assignment: integrationSpecific, accountLimit, or internal',
        },
      },
    },
  },
}
