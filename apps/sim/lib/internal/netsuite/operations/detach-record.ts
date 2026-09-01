import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteRelationshipParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeRelatedType,
} from '@/tools/netsuite/utils'

export const executeNetsuiteDetachRecordOperation: InternalToolOperationImplementation<
  NetSuiteRelationshipParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'POST',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' },
        { value: '!detach', label: 'Detach operation' },
        { value: normalizeRelatedType(params.relatedType), label: 'Related type' },
        { value: params.relatedId, label: 'Related ID' }
      ),
      success: { status: 204, body: 'none' },
    }),
    signal
  )
