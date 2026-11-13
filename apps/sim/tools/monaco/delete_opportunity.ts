import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import type { MonacoDeleteOpportunityParams, MonacoDeleteResponse } from '@/tools/monaco/types'
import { MONACO_API_BASE, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoDeleteOpportunityTool: ToolConfig<
  MonacoDeleteOpportunityParams,
  MonacoDeleteResponse
> = {
  id: 'monaco_delete_opportunity',
  name: 'Monaco Delete Opportunity',
  description: 'Permanently delete a Monaco opportunity. This cannot be undone.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the opportunity to delete',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/opportunities/${safeUrlPathSegment(params.opportunityId, 'opportunityId')}`,
    method: 'DELETE',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { id: params?.opportunityId.trim() ?? '', deleted: true },
  }),

  outputs: {
    id: { type: 'string', description: 'ID of the deleted opportunity' },
    deleted: { type: 'boolean', description: 'Whether Monaco deleted the opportunity' },
  },
}
