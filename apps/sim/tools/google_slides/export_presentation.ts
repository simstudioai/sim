import type { UserFile } from '@/executor/types'
import type { ToolConfig } from '@/tools/types'

export interface ExportPresentationParams {
  accessToken: string
  presentationId: string
  exportFormat?: 'PDF' | 'PPTX' | 'ODP' | 'TXT' | 'PNG' | 'JPEG' | 'SVG'
  _context?: Record<string, unknown>
}

export interface ExportPresentationResponse {
  success: boolean
  output: {
    contentBase64?: string
    file?: UserFile & { mimeType?: string }
    mimeType: string
    sizeBytes: number
    metadata: { presentationId: string; url: string; exportFormat: string }
  }
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
    url: '/api/tools/google_slides/export-presentation',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      presentationId: params.presentationId,
      exportFormat: params.exportFormat,
      workspaceId:
        typeof params._context?.workspaceId === 'string' ? params._context.workspaceId : undefined,
      workflowId:
        typeof params._context?.workflowId === 'string' ? params._context.workflowId : undefined,
      executionId:
        typeof params._context?.executionId === 'string' ? params._context.executionId : undefined,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to export presentation')
    }

    return {
      success: true,
      output: data.output,
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
      description: 'Deprecated legacy inline content. New exports return file.',
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
