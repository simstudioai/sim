import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelWorkbookUrl,
  readExcelJson,
} from '@/tools/microsoft_excel/shared'
import type {
  ExcelCreateSessionParams,
  ExcelCreateSessionResponse,
} from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const createSessionTool: ToolConfig<ExcelCreateSessionParams, ExcelCreateSessionResponse> = {
  id: 'microsoft_excel_create_session',
  name: 'Microsoft Excel Create Session',
  description: 'Create Session in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    accessToken: EXCEL_WORKBOOK_PARAMS.accessToken,
    spreadsheetId: EXCEL_WORKBOOK_PARAMS.spreadsheetId,
    driveId: EXCEL_WORKBOOK_PARAMS.driveId,
    persistChanges: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description:
        'True saves changes; false creates a temporary workbook copy whose changes are discarded when the session ends.',
    },
  },
  request: {
    url: (params) => `${excelWorkbookUrl(params)}/createSession`,
    method: 'POST',
    headers: excelHeaders,
    body: (params) => ({ persistChanges: params.persistChanges }),
  },
  transformResponse: async (response) => {
    const data = await readExcelJson(response)
    if (typeof data.id !== 'string' || typeof data.persistChanges !== 'boolean')
      throw new Error('Microsoft Graph did not return a workbook session')
    return { success: true, output: { sessionId: data.id, persistChanges: data.persistChanges } }
  },
  outputs: {
    sessionId: {
      type: 'string',
      description: 'Pass this ID as sessionId on subsequent workbook operations.',
    },
    persistChanges: { type: 'boolean', description: 'Whether changes in this session are saved.' },
  },
}
