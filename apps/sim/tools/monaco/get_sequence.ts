import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_SEQUENCE_DETAIL_OUTPUT_PROPERTIES,
  type MonacoGetSequenceParams,
  type MonacoSequenceDetailResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoSequenceDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetSequenceTool: ToolConfig<
  MonacoGetSequenceParams,
  MonacoSequenceDetailResponse
> = {
  id: 'monaco_get_sequence',
  name: 'Monaco Get Sequence',
  description: 'Get one Monaco sequence by ID, including its ordered list of tasks.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    sequenceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sequence to fetch',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/sequences/${safeUrlPathSegment(params.sequenceId, 'sequenceId')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { sequence: mapMonacoSequenceDetail(data.data) } }
  },

  outputs: {
    sequence: {
      type: 'object',
      description: 'The sequence with its ordered tasks',
      properties: MONACO_SEQUENCE_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
