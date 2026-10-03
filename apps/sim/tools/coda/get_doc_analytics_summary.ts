import type {
  CodaDocAnalyticsSummaryParams,
  CodaDocAnalyticsSummaryResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  optionalTrimmed,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetDocAnalyticsSummaryTool: ToolConfig<
  CodaDocAnalyticsSummaryParams,
  CodaDocAnalyticsSummaryResponse
> = {
  id: 'coda_get_doc_analytics_summary',
  name: 'Coda Get Doc Analytics Summary',
  description: 'Get the total number of sessions across the Coda docs the user can access',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    isPublished: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include published docs',
    },
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include activity on or after this date (YYYY-MM-DD)',
    },
    untilDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include activity on or before this date (YYYY-MM-DD)',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include docs in this workspace',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl('/analytics/docs/summary', {
        isPublished: params.isPublished,
        sinceDate: optionalTrimmed(params.sinceDate),
        untilDate: optionalTrimmed(params.untilDate),
        workspaceId: optionalTrimmed(params.workspaceId),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { totalSessions: number }
    return { success: true, output: { totalSessions: data.totalSessions } }
  },

  outputs: {
    totalSessions: { type: 'number', description: 'Total sessions across all matching docs' },
  },
}
