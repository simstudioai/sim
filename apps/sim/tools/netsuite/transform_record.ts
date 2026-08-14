import type { NetSuiteResponse, NetSuiteTransformRecordParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteTransformRecordTool: ToolConfig<
  NetSuiteTransformRecordParams,
  NetSuiteResponse
> = {
  id: 'netsuite_transform_record',
  name: 'NetSuite Transform Record',
  description: 'Transform a supported source record into another NetSuite record type.',
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
    targetRecordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target record type supported by the source record metadata',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record fields matching the account-specific NetSuite metadata schema',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'POST',
        path: buildRecordPath(
          { value: params.recordType, label: 'Source record type' },
          { value: params.recordId, label: 'Record ID' },
          { value: '!transform', label: 'Transform operation' },
          { value: params.targetRecordType, label: 'Target record type' }
        ),
        success: { status: 204, body: 'none' },
        responseLocation: 'resource-optional',
        body: params.body ?? {},
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
    location: {
      type: 'string',
      description: 'URL of the transformed record, when NetSuite returns a Location header',
      optional: true,
    },
  },
}
