import type { CodaExportPageParams, CodaExportPageResponse } from '@/tools/coda/types'
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

export const codaExportPageTool: ToolConfig<CodaExportPageParams, CodaExportPageResponse> = {
  id: 'coda_export_page',
  name: 'Coda Export Page',
  description:
    'Start exporting a Coda page as HTML or Markdown. Poll Get Page Export Status with the returned export ID for the download link.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    pageId: PAGE_ID_PARAM,
    outputFormat: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Export format: "markdown" or "html"',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'pages', [params.pageId, 'pageId'], 'export')),
    method: 'POST',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => ({ outputFormat: params.outputFormat }),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { id: string; status: string; href: string }
    return { success: true, output: { exportId: data.id, status: data.status, href: data.href } }
  },

  outputs: {
    exportId: { type: 'string', description: 'ID of the export request' },
    status: { type: 'string', description: 'Export status (inProgress, failed, complete)' },
    href: { type: 'string', description: 'API link that reports the export status' },
  },
}
