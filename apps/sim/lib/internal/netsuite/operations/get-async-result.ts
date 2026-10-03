import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetAsyncResultParams } from '@/tools/netsuite/types'
import { encodePathSegment, executeNetSuiteRequest } from '@/tools/netsuite/utils'

export const executeNetsuiteGetAsyncResultOperation: InternalToolOperationImplementation<
  NetSuiteGetAsyncResultParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => ({
      method: 'GET',
      path: `/services/rest/async/v1/job/${encodePathSegment(params.jobId, 'Job ID')}/task/${encodePathSegment(params.taskId, 'Task ID')}/result`,
      success: { status: 200, body: 'optional-object' },
    }),
    signal
  )
