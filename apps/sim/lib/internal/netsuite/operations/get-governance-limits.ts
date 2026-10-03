import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteSystemParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteGetGovernanceLimitsOperation: InternalToolOperationImplementation<
  NetSuiteSystemParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: '/services/rest/system/v1/governanceLimits',
      success: { status: 200, body: 'object', validator: 'governance-limits' },
    }),
    signal
  )
