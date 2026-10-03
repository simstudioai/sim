import type { NetSuiteResponse, NetSuiteUpsertRecordParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteUpsertRecordTool: InternalToolConfig<
  NetSuiteUpsertRecordParams,
  NetSuiteResponse
> = {
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
      description: 'URL of the created or updated record, when NetSuite returns a Location header',
      optional: true,
    },
  },
}
