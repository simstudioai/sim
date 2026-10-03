import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetSubresourceParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  buildSubresourcePath,
  executeNetSuiteRequest,
} from '@/tools/netsuite/utils'

export const executeNetsuiteGetSubresourceOperation: InternalToolOperationImplementation<
  NetSuiteGetSubresourceParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' },
        ...buildSubresourcePath(params.subresourcePath)
      ),
      success: { status: 200, body: 'object' },
    }),
    signal
  )
