import {
  QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
  type QuartrDocumentDto,
  type QuartrGetDocumentFileResponse,
  type QuartrGetReportParams,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrDocument, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetReportTool: ToolConfig<QuartrGetReportParams, QuartrGetDocumentFileResponse> =
  {
    id: 'quartr_get_report',
    name: 'Quartr Get Report',
    description:
      'Retrieve a filing or report (10-K, 10-Q, earnings release, etc.) from Quartr by its document ID and download the PDF file.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Quartr API key',
      },
      reportId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'Quartr document ID of the report (e.g., 432907)',
      },
    },

    request: {
      url: (params) =>
        buildQuartrUrl(`/documents/reports/${encodeURIComponent(String(params.reportId).trim())}`, {
          expand: 'event',
        }),
      method: 'GET',
      headers: (params) => ({ 'x-api-key': params.apiKey }),
    },

    transformResponse: async (response) => {
      const data = await parseQuartrResponse<QuartrSingleDto<QuartrDocumentDto>>(
        response,
        'get report'
      )
      const document = mapQuartrDocument(data.data)

      return {
        success: true,
        output: {
          document,
          fileUrl: document.fileUrl,
          file: {
            name: `quartr-report-${document.id}.pdf`,
            mimeType: 'application/pdf',
            url: document.fileUrl,
          },
        },
      }
    },

    outputs: {
      document: {
        type: 'object',
        description: 'Report metadata',
        properties: QUARTR_DOCUMENT_OUTPUT_PROPERTIES,
      },
      fileUrl: { type: 'string', description: 'URL of the report PDF' },
      file: {
        type: 'file',
        description: 'Downloaded report PDF stored in execution files',
        fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
      },
    },
  }
