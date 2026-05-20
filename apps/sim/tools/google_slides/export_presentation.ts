import { createLogger } from '@sim/logger'
import { presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesExportPresentationTool')

interface ExportPresentationParams {
  accessToken: string
  presentationId: string
  exportFormat?: 'PDF' | 'PPTX' | 'ODP' | 'TXT' | 'PNG' | 'JPEG' | 'SVG'
}

interface ExportPresentationResponse {
  success: boolean
  output: {
    contentBase64: string
    mimeType: string
    sizeBytes: number
    metadata: { presentationId: string; url: string; exportFormat: string }
  }
}

const FORMAT_TO_MIME: Record<string, string> = {
  PDF: 'application/pdf',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ODP: 'application/vnd.oasis.opendocument.presentation',
  TXT: 'text/plain',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  SVG: 'image/svg+xml',
}

export const exportPresentationTool: ToolConfig<
  ExportPresentationParams,
  ExportPresentationResponse
> = {
  id: 'google_slides_export_presentation',
  name: 'Export Google Slides Presentation',
  description:
    'Export a presentation to PDF, PPTX, ODP, TXT, PNG, JPEG, or SVG via the Drive export endpoint. Returns the file content base64-encoded.',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides / Drive API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    exportFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format: PDF (default), PPTX, ODP, TXT, PNG, JPEG, or SVG',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      if (!presentationId) throw new Error('Presentation ID is required')
      const format = (params.exportFormat || 'PDF').toUpperCase()
      const mime = FORMAT_TO_MIME[format]
      if (!mime) throw new Error(`Unsupported export format: ${format}`)
      return `https://www.googleapis.com/drive/v3/files/${presentationId}/export?mimeType=${encodeURIComponent(mime)}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) throw new Error('Access token is required')
      return { Authorization: `Bearer ${params.accessToken}` }
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      let errorMessage = `Failed to export presentation (status ${response.status})`
      try {
        const data = await response.json()
        errorMessage = data.error?.message || errorMessage
        logger.error('Drive API error during export:', { data })
      } catch {
        // Body wasn't JSON — fall through with default error message.
      }
      throw new Error(errorMessage)
    }

    const buffer = await response.arrayBuffer()
    const contentBase64 = Buffer.from(buffer).toString('base64')

    const presentationId = params?.presentationId?.trim() || ''
    const format = (params?.exportFormat || 'PDF').toUpperCase()
    const mime = FORMAT_TO_MIME[format] ?? 'application/octet-stream'

    return {
      success: true,
      output: {
        contentBase64,
        mimeType: mime,
        sizeBytes: buffer.byteLength,
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          exportFormat: format,
        },
      },
    }
  },

  outputs: {
    contentBase64: { type: 'string', description: 'Base64-encoded exported file content' },
    mimeType: { type: 'string', description: 'MIME type of the exported content' },
    sizeBytes: { type: 'number', description: 'Size of the exported content in bytes' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
        exportFormat: { type: 'string', description: 'Export format used' },
      },
    },
  },
}
