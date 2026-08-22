import type { NetSuiteExecuteActionParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  requiredTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteExecuteActionTool: ToolConfig<NetSuiteExecuteActionParams, NetSuiteResponse> =
  {
    id: 'netsuite_execute_action',
    name: 'NetSuite Execute Record Action',
    description: 'Execute a supported NetSuite record action such as approve, reject, or confirm.',
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
      action: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'NetSuite record action ID without the @ prefix',
      },
      body: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Parameters accepted by the selected NetSuite record action',
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
            { value: `@${requiredTrim(params.action, 'Action')}`, label: 'Action' }
          ),
          success: { status: 200, body: 'object', validator: 'record-action' },
          body: params.body ?? {},
        }),
        signal
      ),
    outputs: {
      status: { type: 'number', description: 'HTTP status returned by NetSuite' },
      data: {
        type: 'json',
        description: 'Documented NetSuite record-action response',
        nullable: true,
        properties: {
          result: {
            type: 'boolean',
            description: 'True when NetSuite completed the record action',
          },
        },
      },
    },
  }
