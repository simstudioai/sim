import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelWorkbookUrl,
} from '@/tools/microsoft_excel/shared'
import type { ExcelCloseSessionResponse, ExcelSessionParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const closeSessionTool: ToolConfig<ExcelSessionParams, ExcelCloseSessionResponse> = {
  id: 'microsoft_excel_close_session',
  name: 'Microsoft Excel Close Session',
  description: 'Close Session in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    ...EXCEL_WORKBOOK_PARAMS,
    sessionId: { ...EXCEL_WORKBOOK_PARAMS.sessionId, required: true },
  },
  request: {
    url: (params) => {
      if (!params.sessionId?.trim()) throw new Error('Session ID is required')
      return `${excelWorkbookUrl(params)}/closeSession`
    },
    method: 'POST',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    await assertExcelSuccess(response)
    return { success: true, output: { closed: true } }
  },
  outputs: { closed: { type: 'boolean', description: 'Whether the workbook session was closed.' } },
}
