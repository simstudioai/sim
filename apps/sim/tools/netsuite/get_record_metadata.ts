import type { NetSuiteGetRecordMetadataParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

const METADATA_ACCEPT = {
  default: 'application/json',
  openapi: 'application/swagger+json',
  json_schema: 'application/schema+json',
} as const

export function getMetadataAccept(format: NetSuiteGetRecordMetadataParams['format']): string {
  const accept = METADATA_ACCEPT[format ?? 'default']
  if (!accept) throw new Error('Metadata format must be default, openapi, or json_schema')
  return accept
}

export const netsuiteGetRecordMetadataTool: InternalToolConfig<
  NetSuiteGetRecordMetadataParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_record_metadata',
  name: 'NetSuite Get Record Metadata',
  description: 'Retrieve account-specific metadata for one NetSuite record type.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'default',
      description: 'Metadata representation: default, openapi, or json_schema',
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
