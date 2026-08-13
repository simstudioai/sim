import type { NetSuiteResponse, NetSuiteUpsertRecordParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  optionalTrim,
  requiredTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteUpsertRecordTool: ToolConfig<NetSuiteUpsertRecordParams, NetSuiteResponse> = {
  id: 'netsuite_upsert_record',
  name: 'NetSuite Upsert Record',
  description: 'Create or update a NetSuite record by external ID with PUT.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    externalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'External ID without the eid: prefix',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Record fields matching the account-specific NetSuite metadata schema',
    },
    replace: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated sublists whose existing lines should be replaced',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'PUT',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          { value: `eid:${requiredTrim(params.externalId, 'External ID')}`, label: 'External ID' }
        ),
        success: { status: 204, body: 'none' },
        query: { replace: optionalTrim(params.replace, 'Replace sublists') },
        body: params.body,
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
