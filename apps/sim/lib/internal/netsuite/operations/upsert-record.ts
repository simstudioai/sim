import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteUpsertRecordParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest, requiredTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteUpsertRecordOperation: InternalToolOperationImplementation<
  NetSuiteUpsertRecordParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'PUT',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: `eid:${requiredTrim(params.externalId, 'External ID')}`, label: 'External ID' }
      ),
      success: { status: 204, body: 'none' },
      responseLocation: 'resource-optional',
      body: params.body,
    }),
    signal
  )
