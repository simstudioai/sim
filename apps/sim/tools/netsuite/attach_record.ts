import type { NetSuiteAttachParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteAttachRecordTool: InternalToolConfig<NetSuiteAttachParams, NetSuiteResponse> =
  {
    id: 'netsuite_attach_record',
    name: 'NetSuite Attach Record or File',
    description: 'Attach a contact or file to another NetSuite record.',
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
      roleId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional contact role internal ID',
      },
      roleExternalId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional contact role external ID',
      },
    },
    operation: {
      input: createInternalToolOperationInput,
    },
    outputs: {
      status: { type: 'number', description: 'HTTP status returned by NetSuite' },
      data: {
        type: 'json',
        description: 'Empty for the documented HTTP 204 No Content response',
        nullable: true,
      },
    },
  }
