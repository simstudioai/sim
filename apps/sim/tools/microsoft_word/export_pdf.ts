import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftWordExportPdfResponse,
  MicrosoftWordToolParams,
} from '@/tools/microsoft_word/types'
import type { InternalToolConfig } from '@/tools/types'

export const exportPdfTool: InternalToolConfig<
  MicrosoftWordToolParams,
  MicrosoftWordExportPdfResponse
> = {
  id: 'microsoft_word_export_pdf',
  name: 'Export Microsoft Word Document as PDF',
  description:
    'Convert a Microsoft Word (.docx) document to PDF using Microsoft Graph and return it as a file.',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-word',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Graph API',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The drive item ID of the Word document to convert',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional name for the generated PDF (e.g., "report.pdf"). Defaults to the document name with a .pdf extension.',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the document. Required for SharePoint. If omitted, uses the personal OneDrive.',
    },
  },

  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      documentId: params.documentId,
      fileName: params.fileName,
      driveId: params.driveId,
    }),
  },

  outputs: {
    file: {
      type: 'file',
      description: 'The converted PDF, stored in execution files',
      fileConfig: { mimeType: 'application/pdf', extension: 'pdf' },
    },
  },
}
