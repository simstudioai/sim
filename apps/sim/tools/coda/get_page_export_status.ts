import type {
  CodaGetPageExportStatusParams,
  CodaPageExportStatusResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  PAGE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetPageExportStatusTool: ToolConfig<
  CodaGetPageExportStatusParams,
  CodaPageExportStatusResponse
> = {
  id: 'coda_get_page_export_status',
  name: 'Coda Get Page Export Status',
  description:
    'Check a Coda page export and get its download link once complete. Download links expire shortly after they are issued.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    pageId: PAGE_ID_PARAM,
    exportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Export ID returned by Export Page',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(
        codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'], 'export', [
          params.exportId,
          'exportId',
        ])
      ),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      id: string
      status: string
      href: string
      downloadLink?: string
      error?: string
    }
    return {
      success: true,
      output: {
        exportId: data.id,
        status: data.status,
        href: data.href,
        downloadLink: data.downloadLink ?? null,
        exportError: data.error ?? null,
      },
    }
  },

  outputs: {
    exportId: { type: 'string', description: 'ID of the export request' },
    status: { type: 'string', description: 'Export status (inProgress, failed, complete)' },
    href: { type: 'string', description: 'API link that reports the export status' },
    downloadLink: {
      type: 'string',
      description: 'Short-lived download link for the exported file, once complete',
      nullable: true,
    },
    exportError: {
      type: 'string',
      description: 'Error message if the export failed',
      nullable: true,
    },
  },
}
