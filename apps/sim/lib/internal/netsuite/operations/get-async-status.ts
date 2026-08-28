import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteGetAsyncStatusParams } from '@/tools/netsuite/types'
import { encodePathSegment, executeNetSuiteRequest, requiredTrim } from '@/tools/netsuite/utils'

export const executeNetsuiteGetAsyncStatusOperation: InternalToolOperationImplementation<
  NetSuiteGetAsyncStatusParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const view = params.view ?? 'job'
      if (view !== 'job' && view !== 'tasks' && view !== 'task') {
        throw new Error('Async status view must be job, tasks, or task')
      }
      const jobPath = `/services/rest/async/v1/job/${encodePathSegment(params.jobId, 'Job ID')}`
      if (view === 'job') {
        return {
          method: 'GET',
          path: jobPath,
          success: { status: 200, body: 'object', validator: 'async-job' },
        }
      }
      const taskPath =
        view === 'task'
          ? `/${encodePathSegment(requiredTrim(params.taskId ?? '', 'Task ID'), 'Task ID')}`
          : ''
      return {
        method: 'GET',
        path: `${jobPath}/task${taskPath}`,
        success: {
          status: 200,
          body: 'object',
          validator: view === 'task' ? 'async-task' : 'async-task-collection',
        },
      }
    },
    signal
  )
