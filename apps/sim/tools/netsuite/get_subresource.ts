import type { NetSuiteGetSubresourceParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetSubresourceTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'NetSuite response body; record fields are account-specific and dynamic',
      nullable: true,
    },
  },
}
