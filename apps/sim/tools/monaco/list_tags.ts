import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_TAG_OUTPUT_PROPERTIES,
  type MonacoListTagsParams,
  type MonacoListTagsResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoTag, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListTagsTool: ToolConfig<MonacoListTagsParams, MonacoListTagsResponse> = {
  id: 'monaco_list_tags',
  name: 'Monaco List Tags',
  description: 'List every Monaco tag defined for contacts, accounts, or opportunities.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    object: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object type to list tags for. One of contacts, accounts, opportunities.',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/tags/?object=${encodeURIComponent(params.object.trim())}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { tags: toArray(data.data).map(mapMonacoTag) } }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'Tags defined for the object type',
      items: { type: 'object', properties: MONACO_TAG_OUTPUT_PROPERTIES },
    },
  },
}
