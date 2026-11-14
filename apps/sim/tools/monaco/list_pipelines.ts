import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_PIPELINE_OUTPUT_PROPERTIES,
  type MonacoBaseParams,
  type MonacoListPipelinesResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoPipeline, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListPipelinesTool: ToolConfig<MonacoBaseParams, MonacoListPipelinesResponse> = {
  id: 'monaco_list_pipelines',
  name: 'Monaco List Pipelines',
  description:
    "List the organization's Monaco opportunity pipelines, default first, each with its stages in display order. Use the stage keys and IDs to set an opportunity's stage.",
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
  },

  request: {
    url: `${MONACO_API_BASE}/v1/pipelines/`,
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { pipelines: toArray(data.data).map(mapMonacoPipeline) } }
  },

  outputs: {
    pipelines: {
      type: 'array',
      description: 'Opportunity pipelines, default first',
      items: { type: 'object', properties: MONACO_PIPELINE_OUTPUT_PROPERTIES },
    },
  },
}
