import { createLogger } from '@sim/logger'
import {
  authJsonHeaders,
  batchUpdateUrl,
  buildElementProperties,
  generateObjectId,
  presentationUrl,
} from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesCreateSheetsChartTool')

interface CreateSheetsChartParams {
  accessToken: string
  presentationId: string
  pageObjectId: string
  spreadsheetId: string
  chartId: number
  linkingMode?: 'LINKED' | 'NOT_LINKED_IMAGE'
  width?: number
  height?: number
  positionX?: number
  positionY?: number
}

interface CreateSheetsChartResponse {
  success: boolean
  output: {
    chartObjectId: string
    metadata: { presentationId: string; pageObjectId: string; url: string }
  }
}

export const createSheetsChartTool: ToolConfig<CreateSheetsChartParams, CreateSheetsChartResponse> =
  {
    id: 'google_slides_create_sheets_chart',
    name: 'Embed Google Sheets Chart in Slides',
    description:
      'Embed a chart from a Google Sheets spreadsheet onto a slide. LINKED charts can be refreshed; NOT_LINKED_IMAGE inserts a static image of the chart.',
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
      pageObjectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Object ID of the slide to add the chart to',
      },
      spreadsheetId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Google Sheets spreadsheet ID containing the chart',
      },
      chartId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Numeric chart ID within the spreadsheet',
      },
      linkingMode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'LINKED (default) or NOT_LINKED_IMAGE',
      },
      width: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Width in points (default 400)',
      },
      height: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Height in points (default 300)',
      },
      positionX: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'X position in points (default 100)',
      },
      positionY: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Y position in points (default 100)',
      },
    },

    request: {
      url: (params) => batchUpdateUrl(params.presentationId),
      method: 'POST',
      headers: (params) => authJsonHeaders(params.accessToken),
      body: (params) => {
        const pageObjectId = params.pageObjectId?.trim()
        const spreadsheetId = params.spreadsheetId?.trim()
        if (!pageObjectId) throw new Error('Page Object ID is required')
        if (!spreadsheetId) throw new Error('Spreadsheet ID is required')
        if (params.chartId === undefined) throw new Error('Chart ID is required')

        const objectId = generateObjectId('chart')
        const elementProperties = buildElementProperties({
          pageObjectId,
          width: params.width,
          height: params.height,
          positionX: params.positionX,
          positionY: params.positionY,
          defaultWidth: 400,
          defaultHeight: 300,
        })

        return {
          requests: [
            {
              createSheetsChart: {
                objectId,
                spreadsheetId,
                chartId: params.chartId,
                linkingMode: params.linkingMode || 'LINKED',
                elementProperties,
              },
            },
          ],
        }
      },
    },

    transformResponse: async (response: Response, params) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Google Slides API error:', { data })
        throw new Error(data.error?.message || 'Failed to create sheets chart')
      }
      const chartObjectId = data.replies?.[0]?.createSheetsChart?.objectId ?? ''
      const presentationId = params?.presentationId?.trim() || ''
      const pageObjectId = params?.pageObjectId?.trim() || ''
      return {
        success: true,
        output: {
          chartObjectId,
          metadata: { presentationId, pageObjectId, url: presentationUrl(presentationId) },
        },
      }
    },

    outputs: {
      chartObjectId: { type: 'string', description: 'Object ID of the inserted chart' },
      metadata: {
        type: 'object',
        description: 'Operation metadata',
        properties: {
          presentationId: { type: 'string', description: 'The presentation ID' },
          pageObjectId: { type: 'string', description: 'The slide ID' },
          url: { type: 'string', description: 'URL to the presentation' },
        },
      },
    },
  }
