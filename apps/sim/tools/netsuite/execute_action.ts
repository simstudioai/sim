import type { NetSuiteExecuteActionParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteExecuteActionTool: InternalToolConfig<
  NetSuiteExecuteActionParams,
  NetSuiteResponse
> = {
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
  operation: {
    input: createInternalToolOperationInput,
  },
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
