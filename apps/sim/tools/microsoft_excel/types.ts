import type { ToolResponse } from '../types'

export interface MicrosoftExcelRange {
  sheetId?: number
  sheetName?: string
  range: string
  values: any[][]
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
    values: any[][]
    metadata: MicrosoftExcelMetadata
  }
}


export interface MicrosoftExcelToolParams {
  accessToken: string
  spreadsheetId: string
  range?: string
  values?: any[][]
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
  values: any[][]
  rowIndex?: number // For table updates - 0-based index
}
