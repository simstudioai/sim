import type { CodaAnalyticsLastUpdatedResponse, CodaAuthParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetAnalyticsLastUpdatedTool: ToolConfig<
  CodaAuthParams,
  CodaAnalyticsLastUpdatedResponse
> = {
  id: 'coda_get_analytics_last_updated',
  name: 'Coda Get Analytics Last Updated',
  description:
    'Get the dates (Pacific time) Coda analytics were last refreshed, to know how current analytics data is',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams },

  request: {
    url: () => buildCodaUrl('/analytics/updated'),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as CodaAnalyticsLastUpdatedResponse['output']
    return {
      success: true,
      output: {
        docAnalyticsLastUpdated: data.docAnalyticsLastUpdated,
        packAnalyticsLastUpdated: data.packAnalyticsLastUpdated,
        packFormulaAnalyticsLastUpdated: data.packFormulaAnalyticsLastUpdated,
      },
    }
  },

  outputs: {
    docAnalyticsLastUpdated: { type: 'string', description: 'Date doc analytics last updated' },
    packAnalyticsLastUpdated: { type: 'string', description: 'Date Pack analytics last updated' },
    packFormulaAnalyticsLastUpdated: {
      type: 'string',
      description: 'Date Pack formula analytics last updated',
    },
  },
}
