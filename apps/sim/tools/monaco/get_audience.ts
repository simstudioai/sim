import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_AUDIENCE_OUTPUT_PROPERTIES,
  type MonacoAudienceResponse,
  type MonacoGetAudienceParams,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoAudience, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetAudienceTool: ToolConfig<MonacoGetAudienceParams, MonacoAudienceResponse> = {
  id: 'monaco_get_audience',
  name: 'Monaco Get Audience',
  description: 'Get one Monaco audience by ID.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the audience to fetch',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/audiences/${safeUrlPathSegment(params.audienceId, 'audienceId')}`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { audience: mapMonacoAudience(data.data) } }
  },

  outputs: {
    audience: {
      type: 'object',
      description: 'The audience',
      properties: MONACO_AUDIENCE_OUTPUT_PROPERTIES,
    },
  },
}
