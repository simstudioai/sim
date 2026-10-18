import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelWorkbookUrl,
} from '@/tools/microsoft_excel/shared'
import type { ExcelCalculateParams, ExcelCalculateResponse } from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'
export const calculateTool: ToolConfig<ExcelCalculateParams, ExcelCalculateResponse> = {
  id: 'microsoft_excel_calculate',
  name: 'Microsoft Excel Calculate',
  description: 'Calculate in a Microsoft Excel workbook.',
  version: '1.0.0',
  oauth: { required: true, provider: 'microsoft-excel' },
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,
  params: {
    ...EXCEL_WORKBOOK_PARAMS,
    calculationType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Recalculate recalculates dirty cells; Full recalculates all cells; FullRebuild rebuilds dependencies and recalculates all cells.',
    },
  },
  request: {
    url: (params) => `${excelWorkbookUrl(params)}/application/calculate`,
    method: 'POST',
    headers: excelHeaders,
    body: (params) => {
      if (!['Recalculate', 'Full', 'FullRebuild'].includes(params.calculationType))
        throw new Error('Invalid calculation type')
      return { calculationType: params.calculationType }
    },
  },
  transformResponse: async (response) => {
    await assertExcelSuccess(response)
    return { success: true, output: { calculated: true } }
  },
  outputs: {
    calculated: { type: 'boolean', description: 'Whether workbook calculation completed.' },
  },
}
