import type { NetSuiteDeleteRecordParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteDeleteRecordTool: ToolConfig<NetSuiteDeleteRecordParams, NetSuiteResponse> = {
  id: 'netsuite_delete_record',
  name: 'NetSuite Delete Record',
  description: 'Delete one NetSuite record by internal or external ID.',
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
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'DELETE',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          { value: params.recordId, label: 'Record ID' }
        ),
        success: { status: 204, body: 'none' },
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'Empty for the documented HTTP 204 No Content response',
      nullable: true,
    },
  },
}
