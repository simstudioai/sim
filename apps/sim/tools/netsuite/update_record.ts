import type { NetSuiteResponse, NetSuiteUpdateRecordParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteUpdateRecordTool: InternalToolConfig<
  NetSuiteUpdateRecordParams,
  NetSuiteResponse
> = {
  id: 'netsuite_update_record',
  name: 'NetSuite Update Record',
  description: 'Update fields on an existing NetSuite record with PATCH.',
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
    location: {
      type: 'string',
      description: 'Updated record URL from the Location response header',
      optional: true,
    },
  },
}
