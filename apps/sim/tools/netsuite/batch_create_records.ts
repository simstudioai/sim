import type { NetSuiteBatchWriteParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildBatchWriteRequest,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteBatchCreateRecordsTool: ToolConfig<
  NetSuiteBatchWriteParams,
  NetSuiteResponse
> = {
  id: 'netsuite_batch_create_records',
  name: 'NetSuite Batch Create Records',
  description: 'Submit an asynchronous batch that creates up to 100 records of one type.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    items: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of 1-100 records matching the account-specific metadata schema',
      items: { type: 'object', additionalProperties: true },
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional unique idempotency key for retrying the batch',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(params, () => buildBatchWriteRequest('POST', params), signal),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'Empty for the documented HTTP 202 Accepted submission response',
      nullable: true,
    },
    location: {
      type: 'string',
      description: 'Asynchronous job URL from the Location response header',
      optional: true,
    },
    jobId: {
      type: 'string',
      description: 'Asynchronous job ID parsed from the Location header',
      optional: true,
    },
  },
}
