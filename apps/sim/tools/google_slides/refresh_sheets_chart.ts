import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesRefreshSheetsChartTool')

interface RefreshSheetsChartParams {
  accessToken: string
  presentationId: string
  objectId: string
}

interface RefreshSheetsChartResponse {
  success: boolean
  output: {
    refreshed: boolean
    objectId: string
    metadata: { presentationId: string; url: string }
  }
}

export const refreshSheetsChartTool: ToolConfig<
  RefreshSheetsChartParams,
  RefreshSheetsChartResponse
> = {
  id: 'google_slides_refresh_sheets_chart',
  name: 'Refresh Sheets Chart in Slides',
  description:
    'Refresh an embedded linked Sheets chart so it reflects the latest spreadsheet data.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object ID of the embedded chart to refresh',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const objectId = params.objectId?.trim()
      if (!objectId) throw new Error('Object ID is required')
      return { requests: [{ refreshSheetsChart: { objectId } }] }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to refresh sheets chart')
    }
    const presentationId = params?.presentationId?.trim() || ''
    return {
      success: true,
      output: {
        refreshed: true,
        objectId: params?.objectId?.trim() || '',
        metadata: { presentationId, url: presentationUrl(presentationId) },
      },
    }
  },

  outputs: {
    refreshed: { type: 'boolean', description: 'Whether the chart was refreshed' },
    objectId: { type: 'string', description: 'The chart object refreshed' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
      },
    },
  },
}
