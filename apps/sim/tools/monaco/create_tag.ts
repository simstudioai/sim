import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_TAG_OUTPUT_PROPERTIES,
  type MonacoCreateTagParams,
  type MonacoCreateTagResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoTag, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoCreateTagTool: ToolConfig<MonacoCreateTagParams, MonacoCreateTagResponse> = {
  id: 'monaco_create_tag',
  name: 'Monaco Create Tag',
  description: 'Create a Monaco tag for contacts, accounts, or opportunities.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    object: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object type the tag applies to. One of contacts, accounts, opportunities.',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Display name of the tag (max 100 characters). Letters, numbers, and spaces only; must be unique per object type within the organization.',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display color of the tag. One of green, blue, red, yellow, purple, berry, peach, gray.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/tags/`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        object: params.object.trim(),
        name: params.name.trim(),
      }
      const color = params.color?.trim()
      if (color) body.color = color
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { tag: mapMonacoTag(data.data) } }
  },

  outputs: {
    tag: {
      type: 'object',
      description: 'The created tag',
      properties: MONACO_TAG_OUTPUT_PROPERTIES,
    },
  },
}
