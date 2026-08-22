import type { NetSuiteGetRecordParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetRecordTool: ToolConfig<NetSuiteGetRecordParams, NetSuiteResponse> = {
  id: 'netsuite_get_record',
  name: 'NetSuite Get Record',
  description: 'Retrieve one NetSuite record by internal or external ID.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite internal ID or an external-ID reference beginning with eid:',
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
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          { value: params.recordId, label: 'Record ID' }
        ),
        success: { status: 200, body: 'object' },
        query: {
          fields: optionalTrim(params.fields),
          expand: optionalTrim(params.expand),
          expandSubResources: normalizeOptionalBoolean(
            params.expandSubResources,
            'Expand subresources'
          ),
        },
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'NetSuite response body; record fields are account-specific and dynamic',
      nullable: true,
    },
  },
}
