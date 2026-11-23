import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_FIELD_SCHEMA_OUTPUT_PROPERTIES,
  type MonacoGetFieldSchemasParams,
  type MonacoGetFieldSchemasResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoFieldSchema, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetFieldSchemasTool: ToolConfig<
  MonacoGetFieldSchemasParams,
  MonacoGetFieldSchemasResponse
> = {
  id: 'monaco_get_field_schemas',
  name: 'Monaco Get Field Schemas',
  description:
    "List the filterable and sortable fields for a Monaco entity, with each field's key, type, allowed filter operators, whether it is updatable, custom-field settings, and allowed enum values. Use it to build list filters and to interpret custom_field_<id> keys.",
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    entity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Entity to describe. One of accounts, contacts, meetings, opportunities, sequences, tasks.',
    },
  },

  request: {
    url: (params) => `${MONACO_API_BASE}/v1/schemas/${safeUrlPathSegment(params.entity, 'entity')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { fields: toArray(data.data).map(mapMonacoFieldSchema) } }
  },

  outputs: {
    fields: {
      type: 'array',
      description: 'Field schemas for the entity',
      items: { type: 'object', properties: MONACO_FIELD_SCHEMA_OUTPUT_PROPERTIES },
    },
  },
}
