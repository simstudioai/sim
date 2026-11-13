import { toArray, toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, monacoPageParams } from '@/tools/monaco/params'
import {
  MONACO_AUDIENCE_OUTPUT_PROPERTIES,
  MONACO_PAGINATION_OUTPUT,
  type MonacoListAudiencesResponse,
  type MonacoPageParams,
} from '@/tools/monaco/types'
import {
  buildMonacoListBody,
  MONACO_API_BASE,
  mapMonacoAudience,
  mapMonacoPagination,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoListAudiencesTool: ToolConfig<MonacoPageParams, MonacoListAudiencesResponse> = {
  id: 'monaco_list_audiences',
  name: 'Monaco List Audiences',
  description:
    'List Monaco audiences, the reusable contact lists that campaigns enroll. The default page size returns every audience in one page.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    ...monacoPageParams(500, 500),
  },

  request: {
    url: `${MONACO_API_BASE}/v1/audiences/list`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoListBody({ page: params.page, pageSize: params.pageSize }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        audiences: toArray(data.data).map(mapMonacoAudience),
        pagination: mapMonacoPagination(data.pagination),
      },
    }
  },

  outputs: {
    audiences: {
      type: 'array',
      description: 'Audiences on this page',
      items: { type: 'object', properties: MONACO_AUDIENCE_OUTPUT_PROPERTIES },
    },
    pagination: MONACO_PAGINATION_OUTPUT,
  },
}
