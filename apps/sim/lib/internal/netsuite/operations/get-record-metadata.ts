import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { getMetadataAccept } from '@/tools/netsuite/get_record_metadata'
import type { NetSuiteGetRecordMetadataParams } from '@/tools/netsuite/types'
import { encodePathSegment, executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteGetRecordMetadataOperation: InternalToolOperationImplementation<
  NetSuiteGetRecordMetadataParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: `/services/rest/record/v1/metadata-catalog/${encodePathSegment(params.recordType, 'Record type')}`,
      success: { status: 200, body: 'object' },
      headers: { Accept: getMetadataAccept(params.format) },
    }),
    signal
  )
