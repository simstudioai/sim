import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelWorkbookUrl,
} from '@/tools/microsoft_excel/shared'
import type { ExcelRefreshSessionResponse, ExcelSessionParams } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const refreshSessionTool: ToolConfig<ExcelSessionParams, ExcelRefreshSessionResponse> = {
  id: 'microsoft_excel_refresh_session',
  name: 'Microsoft Excel Refresh Session',
  description: 'Refresh Session in a Microsoft Excel workbook.',
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
      return `${excelWorkbookUrl(params)}/refreshSession`
    },
    method: 'POST',
    headers: excelHeaders,
  },
  transformResponse: async (response) => {
    await assertExcelSuccess(response)
    return { success: true, output: { refreshed: true } }
  },
  outputs: {
    refreshed: { type: 'boolean', description: 'Whether the workbook session was refreshed.' },
  },
}
