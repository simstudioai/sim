import type { ToolResponse } from '@/tools/types'

// Type for Excel cell values - covers all valid data types that Excel supports
export type ExcelCellValue = string | number | boolean | null

interface MicrosoftExcelRange {
  range: string
  values: ExcelCellValue[][]
}

interface MicrosoftExcelMetadata {
  spreadsheetId: string
  spreadsheetUrl?: string
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

export interface MicrosoftExcelWorksheetAddResponse extends ToolResponse {
  output: {
    worksheet: {
      id: string
      name: string
      position: number
      visibility: string
    }
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  range?: string
  values?: ExcelCellValue[][]
  valueInputOption?: 'RAW' | 'USER_ENTERED'
  includeValuesInResponse?: boolean
}

export interface MicrosoftExcelTableToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  tableName: string
  values: ExcelCellValue[][]
}

export interface MicrosoftExcelWorksheetToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  worksheetName: string
}

export interface MicrosoftExcelClearRangeParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sheetName?: string
  range: string
  applyTo?: 'All' | 'Formats' | 'Contents'
}

export interface MicrosoftExcelClearRangeResponse extends ToolResponse {
  output: {
    cleared: boolean
    range: string
    applyTo: string
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelFormatRangeParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sheetName?: string
  range: string
  fillColor?: string
  fontBold?: boolean
  fontItalic?: boolean
  fontColor?: string
  fontSize?: number
  fontName?: string
}

export interface MicrosoftExcelFormatRangeResponse extends ToolResponse {
  output: {
    formatted: boolean
    range: string
    fill: { color: string | null } | null
    font: {
      bold: boolean | null
      italic: boolean | null
      color: string | null
      name: string | null
      size: number | null
    } | null
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelCreateTableParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  address: string
  hasHeaders?: boolean
}

export interface MicrosoftExcelCreateTableResponse extends ToolResponse {
  output: {
    table: {
      id: string
      name: string
      showHeaders: boolean
      showTotals: boolean
      style: string | null
    }
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelDeleteWorksheetParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  worksheetName: string
}

export interface MicrosoftExcelDeleteWorksheetResponse extends ToolResponse {
  output: {
    deleted: boolean
    worksheetName: string
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelSortRangeParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sheetName?: string
  range?: string
  tableName?: string
  sortColumn: number
  sortAscending?: boolean
  hasHeaders?: boolean
  matchCase?: boolean
}

export interface MicrosoftExcelSortRangeResponse extends ToolResponse {
  output: {
    sorted: boolean
    target: string
    sortColumn: number
    ascending: boolean
    metadata: MicrosoftExcelMetadata
  }
}

export type MicrosoftExcelResponse =
  | MicrosoftExcelReadResponse
  | MicrosoftExcelWriteResponse
  | MicrosoftExcelTableAddResponse
  | MicrosoftExcelWorksheetAddResponse
  | MicrosoftExcelClearRangeResponse
  | MicrosoftExcelFormatRangeResponse
  | MicrosoftExcelCreateTableResponse
  | MicrosoftExcelDeleteWorksheetResponse
  | MicrosoftExcelSortRangeResponse

// V2 Types - with separate sheetName param
export interface MicrosoftExcelV2ToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sheetName: string
  cellRange?: string
  values?: ExcelCellValue[][]
  valueInputOption?: 'RAW' | 'USER_ENTERED'
  includeValuesInResponse?: boolean
}

export interface MicrosoftExcelV2ReadResponse extends ToolResponse {
  output: {
    sheetName: string
    range: string
    values: ExcelCellValue[][]
    metadata: {
      spreadsheetId: string
      spreadsheetUrl: string
    }
  }
}

export interface MicrosoftExcelV2WriteResponse extends ToolResponse {
  output: {
    updatedRange: string | null
    updatedRows: number
    updatedColumns: number
    updatedCells: number
    metadata: {
      spreadsheetId: string
      spreadsheetUrl: string
    }
  }
}

export type MicrosoftExcelV2Response = MicrosoftExcelV2ReadResponse | MicrosoftExcelV2WriteResponse
