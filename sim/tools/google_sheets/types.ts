import { ToolResponse } from '../types'

export interface GoogleSheetsRange {
  sheetId?: number
  sheetName?: string
  range: string
  values: any[][]
}

export interface GoogleSheetsMetadata {
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

export interface GoogleSheetsReadResponse extends ToolResponse {
  output: {
    data: GoogleSheetsRange
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsWriteResponse extends ToolResponse {
  output: {
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsUpdateResponse extends ToolResponse {
  output: {
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsAppendResponse extends ToolResponse {
  output: {
    tableRange: string
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsToolParams {
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
