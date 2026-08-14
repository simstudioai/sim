import type { NetSuiteGetSubresourceParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  buildSubresourcePath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetSubresourceTool: ToolConfig<
  NetSuiteGetSubresourceParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_subresource',
  name: 'NetSuite Get Subresource',
  description: 'Retrieve a record sublist, subrecord, referenced record, or nested subresource.',
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
    subresourcePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slash-separated subresource path, such as item or item/1/inventoryDetail',
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
          { value: params.recordId, label: 'Record ID' },
          ...buildSubresourcePath(params.subresourcePath)
        ),
        success: { status: 200, body: 'object' },
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
