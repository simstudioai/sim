import type { NetSuiteGetRecordMetadataParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  encodePathSegment,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

const METADATA_ACCEPT = {
  default: 'application/json',
  openapi: 'application/swagger+json',
  json_schema: 'application/schema+json',
} as const

function getMetadataAccept(format: NetSuiteGetRecordMetadataParams['format']): string {
  const accept = METADATA_ACCEPT[format ?? 'default']
  if (!accept) throw new Error('Metadata format must be default, openapi, or json_schema')
  return accept
}

export const netsuiteGetRecordMetadataTool: ToolConfig<
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
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: `/services/rest/record/v1/metadata-catalog/${encodePathSegment(params.recordType, 'Record type')}`,
        success: { status: 200, body: 'object' },
        headers: { Accept: getMetadataAccept(params.format) },
      }),
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
