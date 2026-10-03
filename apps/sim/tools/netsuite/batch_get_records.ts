import type { NetSuiteBatchGetParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteBatchGetRecordsTool: InternalToolConfig<
  NetSuiteBatchGetParams,
  NetSuiteResponse
> = {
  id: 'netsuite_batch_get_records',
  name: 'NetSuite Batch Get Records',
  description: 'Submit an asynchronous request to retrieve up to 100 records of one type.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    ids: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Up to 100 comma-separated internal IDs or eid: external-ID references',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated record fields to return',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated resources to expand when supported by the record metadata',
    },
    expandSubResources: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to expand sublists and subrecords in the response',
    },
    idempotencyKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional unique idempotency key for retrying the asynchronous request',
    },
  },
  operation: {
    input: createInternalToolOperationInput,
  },
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
