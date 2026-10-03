import type { NetSuiteResponse, NetSuiteSystemParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetGovernanceLimitsTool: InternalToolConfig<
  NetSuiteSystemParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_governance_limits',
  name: 'NetSuite Get Governance Limits',
  description:
    'Retrieve REST web-services concurrency limits for the NetSuite account and integration; NetSuite requires an Administrator role.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
  },
  operation: {
    input: createInternalToolOperationInput,
  },
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
