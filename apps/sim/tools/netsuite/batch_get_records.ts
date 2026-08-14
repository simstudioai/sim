import type { NetSuiteBatchGetParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizeBatchIds,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteBatchGetRecordsTool: ToolConfig<NetSuiteBatchGetParams, NetSuiteResponse> = {
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
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => {
        const idempotencyKey = optionalTrim(params.idempotencyKey, 'Idempotency key')
        return {
          method: 'GET',
          path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
          success: { status: 202, body: 'none' },
          responseLocation: 'async-job',
          query: {
            expandRecords: true,
            ids: normalizeBatchIds(params.ids),
            fields: optionalTrim(params.fields, 'Fields'),
            expand: optionalTrim(params.expand, 'Expand'),
            expandSubResources: normalizeOptionalBoolean(
              params.expandSubResources,
              'Expand subresources'
            ),
          },
          headers: {
            Prefer: 'respond-async',
            ...(idempotencyKey ? { 'X-NetSuite-idempotency-key': idempotencyKey } : {}),
          },
        }
      },
      signal
    ),
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
