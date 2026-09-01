import type { NetSuiteResponse, NetSuiteTransformRecordParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteTransformRecordTool: InternalToolConfig<
  NetSuiteTransformRecordParams,
  NetSuiteResponse
> = {
  id: 'netsuite_transform_record',
  name: 'NetSuite Transform Record',
  description: 'Transform a supported source record into another NetSuite record type.',
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
    targetRecordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target record type supported by the source record metadata',
    },
    body: {
      type: 'json',
      required: false,
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
      description: 'URL of the transformed record, when NetSuite returns a Location header',
      optional: true,
    },
  },
}
