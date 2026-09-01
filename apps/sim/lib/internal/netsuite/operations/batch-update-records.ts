import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteBatchWriteParams } from '@/tools/netsuite/types'
import { buildBatchWriteRequest, executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteBatchUpdateRecordsOperation: InternalToolOperationImplementation<
  NetSuiteBatchWriteParams
> = (params, signal) =>
  executeNetSuiteRequest(params, () => buildBatchWriteRequest('PATCH', params), signal)
