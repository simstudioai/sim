import type { ToolResponse } from '@/tools/types'

// Type for Excel cell values - covers all valid data types that Excel supports
export type ExcelCellValue = string | number | boolean | null

export interface MicrosoftExcelRange {
  sheetId?: number
  sheetName?: string
  range: string
  values: ExcelCellValue[][]
}

export interface MicrosoftExcelMetadata {
  spreadsheetId: string
  spreadsheetUrl?: string
  title?: string
  sheets?: {
    sheetId: number
    title: string
    index: number
    rowCount?: number
    columnCount?: number
  }[]
}

export interface MicrosoftExcelReadResponse extends ToolResponse {
  output: {
    data: MicrosoftExcelRange
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelWriteResponse extends ToolResponse {
  output: {
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelTableAddResponse extends ToolResponse {
  output: {
    index: number
    values: ExcelCellValue[][]
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelToolParams {
  accessToken: string
  spreadsheetId: string
  range?: string
  values?: ExcelCellValue[][]
  valueInputOption?: 'RAW' | 'USER_ENTERED'
  insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS'
  includeValuesInResponse?: boolean
  responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
  majorDimension?: 'ROWS' | 'COLUMNS'
}

export interface MicrosoftExcelTableToolParams {
  accessToken: string
  spreadsheetId: string
  tableName: string
  values: ExcelCellValue[][]
  rowIndex?: number
}

export type MicrosoftExcelResponse =
  | MicrosoftExcelReadResponse
  | MicrosoftExcelWriteResponse
  | MicrosoftExcelTableAddResponse
