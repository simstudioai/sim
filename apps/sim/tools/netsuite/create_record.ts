import type { NetSuiteCreateRecordParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  optionalTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteCreateRecordTool: ToolConfig<NetSuiteCreateRecordParams, NetSuiteResponse> = {
  id: 'netsuite_create_record',
  name: 'NetSuite Create Record',
  description: 'Create a NetSuite record using the account-specific record metadata schema.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
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
      description: 'Comma-separated sublists whose default lines should be replaced',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => {
        const replace = optionalTrim(params.replace, 'Replace sublists')
        return {
          method: 'POST',
          path: buildRecordPath({ value: params.recordType, label: 'Record type' }),
          success: replace ? { status: 201, body: 'object' } : { status: 204, body: 'none' },
          responseLocation: 'resource',
          query: { replace },
          body: params.body,
        }
      },
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description:
        'Empty for standard HTTP 204 creation; replacement creation can return the documented HTTP 201 post-state object',
      nullable: true,
    },
    location: {
      type: 'string',
      description: 'Newly created record URL from the Location response header',
      optional: true,
    },
  },
}
