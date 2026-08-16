import type { NetSuiteRelationshipParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizeRelatedType,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteDetachRecordTool: ToolConfig<NetSuiteRelationshipParams, NetSuiteResponse> = {
  id: 'netsuite_detach_record',
  name: 'NetSuite Detach Record or File',
  description: 'Detach a contact or file from another NetSuite record.',
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
    relatedType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Related resource type: contact or file',
    },
    relatedId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Internal ID, or external ID prefixed with eid:, of the contact or file',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'POST',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          { value: params.recordId, label: 'Record ID' },
          { value: '!detach', label: 'Detach operation' },
          { value: normalizeRelatedType(params.relatedType), label: 'Related type' },
          { value: params.relatedId, label: 'Related ID' }
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
