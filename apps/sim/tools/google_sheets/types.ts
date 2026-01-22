import type { ToolResponse } from '@/tools/types'

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

export type GoogleSheetsResponse =
  | GoogleSheetsReadResponse
  | GoogleSheetsWriteResponse
  | GoogleSheetsUpdateResponse
  | GoogleSheetsAppendResponse

// V2 Types - with explicit sheetName parameter

export interface GoogleSheetsV2ReadResponse extends ToolResponse {
  output: {
    sheetName: string
    range: string
    values: any[][]
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsV2WriteResponse extends ToolResponse {
  output: {
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsV2UpdateResponse extends ToolResponse {
  output: {
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsV2AppendResponse extends ToolResponse {
  output: {
    tableRange: string
    updatedRange: string
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: GoogleSheetsMetadata
  }
}

export interface GoogleSheetsV2ToolParams {
  accessToken: string
  spreadsheetId: string
  sheetName: string
  cellRange?: string
  values?: any[][]
  valueInputOption?: 'RAW' | 'USER_ENTERED'
  insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS'
  includeValuesInResponse?: boolean
  responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
  majorDimension?: 'ROWS' | 'COLUMNS'
}

export type GoogleSheetsV2Response =
  | GoogleSheetsV2ReadResponse
  | GoogleSheetsV2WriteResponse
  | GoogleSheetsV2UpdateResponse
  | GoogleSheetsV2AppendResponse
  | GoogleSheetsV2ClearResponse
  | GoogleSheetsV2GetSpreadsheetResponse
  | GoogleSheetsV2CreateSpreadsheetResponse
  | GoogleSheetsV2BatchGetResponse
  | GoogleSheetsV2BatchUpdateResponse
  | GoogleSheetsV2BatchClearResponse
  | GoogleSheetsV2CopySheetResponse

// V2 Clear Types
export interface GoogleSheetsV2ClearParams {
  accessToken: string
  spreadsheetId: string
  sheetName: string
  cellRange?: string
}

export interface GoogleSheetsV2ClearResponse extends ToolResponse {
  output: {
    clearedRange: string
    sheetName: string
    metadata: GoogleSheetsMetadata
  }
}

// V2 Get Spreadsheet Types
export interface GoogleSheetsV2GetSpreadsheetParams {
  accessToken: string
  spreadsheetId: string
  includeGridData?: boolean
}

export interface GoogleSheetsV2GetSpreadsheetResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    title: string
    locale: string | null
    timeZone: string | null
    spreadsheetUrl: string
    sheets: {
      sheetId: number
      title: string
      index: number
      rowCount: number | null
      columnCount: number | null
      hidden: boolean
    }[]
  }
}

// V2 Create Spreadsheet Types
export interface GoogleSheetsV2CreateSpreadsheetParams {
  accessToken: string
  title: string
  sheetTitles?: string[]
  locale?: string
  timeZone?: string
}

export interface GoogleSheetsV2CreateSpreadsheetResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    title: string
    spreadsheetUrl: string
    sheets: {
      sheetId: number
      title: string
      index: number
    }[]
  }
}

// V2 Batch Get Types
export interface GoogleSheetsV2BatchGetParams {
  accessToken: string
  spreadsheetId: string
  ranges: string[]
  majorDimension?: 'ROWS' | 'COLUMNS'
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA'
}

export interface GoogleSheetsV2BatchGetResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    valueRanges: {
      range: string
      majorDimension: string
      values: any[][]
    }[]
    metadata: GoogleSheetsMetadata
  }
}

// V2 Batch Update Types
export interface GoogleSheetsV2BatchUpdateParams {
  accessToken: string
  spreadsheetId: string
  data: {
    range: string
    values: any[][]
  }[]
  valueInputOption?: 'RAW' | 'USER_ENTERED'
}

export interface GoogleSheetsV2BatchUpdateResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    totalUpdatedRows: number
    totalUpdatedColumns: number
    totalUpdatedCells: number
    totalUpdatedSheets: number
    responses: {
      spreadsheetId: string
      updatedRange: string
      updatedRows: number
      updatedColumns: number
      updatedCells: number
    }[]
    metadata: GoogleSheetsMetadata
  }
}

// V2 Batch Clear Types
export interface GoogleSheetsV2BatchClearParams {
  accessToken: string
  spreadsheetId: string
  ranges: string[]
}

export interface GoogleSheetsV2BatchClearResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    clearedRanges: string[]
    metadata: GoogleSheetsMetadata
  }
}

// V2 Copy Sheet Types
export interface GoogleSheetsV2CopySheetParams {
  accessToken: string
  sourceSpreadsheetId: string
  sheetId: number
  destinationSpreadsheetId: string
}

export interface GoogleSheetsV2CopySheetResponse extends ToolResponse {
  output: {
    sheetId: number
    title: string
    index: number
    sheetType: string
    destinationSpreadsheetId: string
    destinationSpreadsheetUrl: string
  }
}
