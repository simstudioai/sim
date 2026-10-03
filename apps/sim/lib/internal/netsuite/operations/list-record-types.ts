import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteListRecordTypesParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteListRecordTypesOperation: InternalToolOperationImplementation<
  NetSuiteListRecordTypesParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: '/services/rest/record/v1/metadata-catalog',
      success: { status: 200, body: 'object', validator: 'metadata-catalog' },
    }),
    signal
  )
