import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_CONTACT_DETAIL_OUTPUT_PROPERTIES,
  type MonacoGetContactParams,
  type MonacoGetContactResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoContactDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetContactTool: ToolConfig<MonacoGetContactParams, MonacoGetContactResponse> = {
  id: 'monaco_get_contact',
  name: 'Monaco Get Contact',
  description:
    'Get one Monaco contact by ID, including scoring, heat score explanations, and custom fields.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the contact to fetch',
    },
    includeReasoning: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return each custom field as {value, reasoning, confidence, citations} instead of the bare value. Defaults to false.',
    },
  },

  request: {
    url: (params) => {
      const url = `${MONACO_API_BASE}/v1/contacts/${safeUrlPathSegment(params.contactId, 'contactId')}`
      return params.includeReasoning === undefined
        ? url
        : `${url}?include_reasoning=${params.includeReasoning}`
    },
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { contact: mapMonacoContactDetail(data.data) } }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The contact',
      properties: MONACO_CONTACT_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
