import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteSuiteQLParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest, normalizePagination, requiredTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteExecuteSuiteQLOperation: InternalToolOperationImplementation<
  NetSuiteSuiteQLParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'POST',
      path: '/services/rest/query/v1/suiteql',
      success: { status: 200, body: 'object', validator: 'suiteql-page' },
      query: normalizePagination(params.limit, params.offset),
      headers: { Prefer: 'transient' },
      body: { q: requiredTrim(params.query, 'SuiteQL query') },
    }),
    signal
  )
