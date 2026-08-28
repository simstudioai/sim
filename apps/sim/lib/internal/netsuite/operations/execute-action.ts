import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteExecuteActionParams } from '@/tools/netsuite/types'
import { buildRecordPath, executeNetSuiteRequest, requiredTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteExecuteActionOperation: InternalToolOperationImplementation<
  NetSuiteExecuteActionParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'POST',
      path: buildRecordPath(
        { value: params.recordType, label: 'Record type' },
        { value: params.recordId, label: 'Record ID' },
        { value: `@${requiredTrim(params.action, 'Action')}`, label: 'Action' }
      ),
      success: { status: 200, body: 'object', validator: 'record-action' },
      body: params.body ?? {},
    }),
    signal
  )
