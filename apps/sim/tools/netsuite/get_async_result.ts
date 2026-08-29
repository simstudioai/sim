import type { NetSuiteGetAsyncResultParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetAsyncResultTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
  },
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
