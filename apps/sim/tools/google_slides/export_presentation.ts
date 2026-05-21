import { createLogger } from '@sim/logger'
import {
  PayloadSizeLimitError,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import type { UserFile } from '@/executor/types'
import { presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesExportPresentationTool')

interface ExportPresentationParams {
  accessToken: string
  presentationId: string
  exportFormat?: 'PDF' | 'PPTX' | 'ODP' | 'TXT' | 'PNG' | 'JPEG' | 'SVG'
  _context?: Record<string, unknown>
}

interface ExportPresentationResponse {
  success: boolean
  output: {
    contentBase64?: string
    file?: UserFile & { mimeType?: string }
    mimeType: string
    sizeBytes: number
    metadata: { presentationId: string; url: string; exportFormat: string }
  }
}

export const MAX_GOOGLE_SLIDES_EXPORT_BYTES = 10 * 1024 * 1024
export const MAX_LEGACY_INLINE_EXPORT_BYTES = 7 * 1024 * 1024

export const FORMAT_TO_MIME: Record<string, string> = {
  PDF: 'application/pdf',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ODP: 'application/vnd.oasis.opendocument.presentation',
  TXT: 'text/plain',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  SVG: 'image/svg+xml',
}

export function getGoogleSlidesExportExecutionContext(params?: ExportPresentationParams): {
  context?: { workspaceId: string; workflowId: string; executionId: string }
  userId?: string
} {
  const context = (
    params as (ExportPresentationParams & { _context?: Record<string, unknown> }) | undefined
  )?._context
  const workspaceId = typeof context?.workspaceId === 'string' ? context.workspaceId : undefined
  const workflowId = typeof context?.workflowId === 'string' ? context.workflowId : undefined
  const executionId = typeof context?.executionId === 'string' ? context.executionId : undefined
  const userId = typeof context?.userId === 'string' ? context.userId : undefined

  if (!workspaceId || !workflowId || !executionId) {
    return { userId }
  }

  return { context: { workspaceId, workflowId, executionId }, userId }
}

export async function readGoogleSlidesExportResponse(response: Response): Promise<Buffer> {
  if (!response.ok) {
    let errorMessage = `Failed to export presentation (status ${response.status})`
    try {
      const text = await readResponseTextWithLimit(response, {
        maxBytes: 64 * 1024,
        label: 'Google Slides export error response',
      })
      const data = JSON.parse(text)
      errorMessage = data.error?.message || errorMessage
      logger.error('Drive API error during export:', { data })
    } catch {}
    throw new Error(errorMessage)
  }

  return readResponseToBufferWithLimit(response, {
    maxBytes: MAX_GOOGLE_SLIDES_EXPORT_BYTES,
    label: 'Google Slides export',
  })
}

export const exportPresentationTool: ToolConfig<
  ExportPresentationParams,
  ExportPresentationResponse
> = {
  id: 'google_slides_export_presentation',
  name: 'Export Google Slides Presentation',
  description:
    'Export a presentation to PDF, PPTX, ODP, TXT, PNG, JPEG, or SVG via the Drive export endpoint. Stores the exported file as an execution file when execution context is available.',
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
    const buffer = await readGoogleSlidesExportResponse(response)
    const presentationId = params?.presentationId?.trim() || ''
    const format = (params?.exportFormat || 'PDF').toUpperCase()
    const mime = FORMAT_TO_MIME[format] ?? 'application/octet-stream'
    if (buffer.length > MAX_LEGACY_INLINE_EXPORT_BYTES) {
      throw new PayloadSizeLimitError({
        label: 'Google Slides legacy inline export',
        maxBytes: MAX_LEGACY_INLINE_EXPORT_BYTES,
        observedBytes: buffer.length,
      })
    }
    const contentBase64 = buffer.toString('base64')

    return {
      success: true,
      output: {
        contentBase64,
        mimeType: mime,
        sizeBytes: buffer.length,
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          exportFormat: format,
        },
      },
    }
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Stored exported presentation file',
      optional: true,
    },
    contentBase64: {
      type: 'string',
      description: 'Legacy base64 content field for small exports.',
      optional: true,
    },
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
