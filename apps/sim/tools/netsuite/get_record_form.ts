import type { NetSuiteGetRecordFormParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizeOptionalBoolean,
  optionalTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetRecordFormTool: ToolConfig<NetSuiteGetRecordFormParams, NetSuiteResponse> =
  {
    id: 'netsuite_get_record_form',
    name: 'NetSuite Get Record Form',
    description: 'Return a prepopulated create form, or an edit form when a record ID is supplied.',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'Existing record ID; omit to request a create form',
      },
      body: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Record fields matching the account-specific NetSuite metadata schema',
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
        () => {
          const recordId = optionalTrim(params.recordId)
          return {
            method: recordId ? 'PATCH' : 'POST',
            path: buildRecordPath(
              { value: params.recordType, label: 'Record type' },
              ...(recordId ? [{ value: recordId, label: 'Record ID' }] : [])
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
            headers: {
              Accept: `application/vnd.oracle.resource+json; type=${recordId ? 'edit-form' : 'create-form'}`,
            },
            body: params.body ?? {},
          }
        },
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
