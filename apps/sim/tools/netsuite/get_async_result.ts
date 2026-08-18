import type { NetSuiteGetAsyncResultParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  encodePathSegment,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetAsyncResultTool: ToolConfig<
  NetSuiteGetAsyncResultParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_async_result',
  name: 'NetSuite Get Async Operation Result',
  description: 'Retrieve the provider response for one task within a completed asynchronous job.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asynchronous job ID',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task ID within the asynchronous job',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: `/services/rest/async/v1/job/${encodePathSegment(params.jobId, 'Job ID')}/task/${encodePathSegment(params.taskId, 'Task ID')}/result`,
        success: { status: 200, body: 'optional-object' },
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description:
        'Result payload for the submitted asynchronous operation; record fields are account-specific and dynamic',
      nullable: true,
    },
  },
}
