import type { NetSuiteCreateRecordParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteCreateRecordTool: InternalToolConfig<
  NetSuiteCreateRecordParams,
  NetSuiteResponse
> = {
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
  operation: {
    input: createInternalToolOperationInput,
  },
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
