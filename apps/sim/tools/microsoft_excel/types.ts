interface ExcelRangeFields {
  values: ExcelCellValue[][]
  addressLocal: string | null
  cellCount: number | null
  columnCount: number | null
  columnHidden: boolean | null
  columnIndex: number | null
  formulas: ExcelCellValue[][]
  formulasLocal: ExcelCellValue[][]
  formulasR1C1: ExcelCellValue[][]
  hidden: boolean | null
  numberFormat: ExcelCellValue[][]
  rowCount: number | null
  rowHidden: boolean | null
  rowIndex: number | null
  text: ExcelCellValue[][]
  valueTypes: ExcelCellValue[][]
}

import type { ToolResponse } from '@/tools/types'

export type ExcelCellValue = string | number | boolean | null

interface MicrosoftExcelRange extends ExcelRangeFields {
  range: string
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
  output: ExcelRangeFields & {
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
  sessionId?: string
  range?: string
  values?: ExcelCellValue[][]
  formulas?: ExcelCellValue[][]
  formulasLocal?: ExcelCellValue[][]
  formulasR1C1?: ExcelCellValue[][]
  numberFormat?: ExcelCellValue[][]
  columnHidden?: boolean
  rowHidden?: boolean
}

export interface MicrosoftExcelTableToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
  tableName: string
  index?: number
  values?: ExcelCellValue[][]
}

export interface MicrosoftExcelWorksheetToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
  worksheetName?: string
}

export interface MicrosoftExcelClearRangeParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
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
  sessionId?: string
  sheetName?: string
  range: string
  fillColor?: string
  fontBold?: boolean
  fontItalic?: boolean
  fontColor?: string
  fontSize?: number
  fontName?: string
  fontUnderline?: string
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
      underline: string | null
    } | null
    metadata: MicrosoftExcelMetadata
  }
}

export interface MicrosoftExcelCreateTableParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
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
  sessionId?: string
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
  sessionId?: string
  sheetName?: string
  range?: string
  tableName?: string
  sortColumn?: number
  sortFields?: unknown
  sortMethod?: string
  orientation?: string
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

export interface MicrosoftExcelV2ToolParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
  sheetName: string
  cellRange?: string
  values?: ExcelCellValue[][]
  formulas?: ExcelCellValue[][]
  formulasLocal?: ExcelCellValue[][]
  formulasR1C1?: ExcelCellValue[][]
  numberFormat?: ExcelCellValue[][]
  columnHidden?: boolean
  rowHidden?: boolean
}

export interface MicrosoftExcelV2ReadResponse extends ToolResponse {
  output: ExcelRangeFields & {
    sheetName: string
    range: string
    metadata: {
      spreadsheetId: string
      spreadsheetUrl: string
    }
  }
}

export interface MicrosoftExcelV2WriteResponse extends ToolResponse {
  output: ExcelRangeFields & {
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

export interface ExcelWorkbookParams {
  accessToken: string
  spreadsheetId: string
  driveId?: string
  sessionId?: string
}
export interface ExcelListParams extends ExcelWorkbookParams {
  top?: number
  skip?: number
}
export interface ExcelWorksheetParams extends ExcelWorkbookParams {
  sheetName: string
}
export interface ExcelUpdateWorksheetParams extends ExcelWorksheetParams {
  name?: string
  position?: number
  visibility?: 'Visible' | 'Hidden' | 'VeryHidden'
}
export interface ExcelTableParams extends ExcelWorkbookParams {
  tableName: string
}
export interface ExcelListRowsParams extends ExcelTableParams {
  top?: number
  skip?: number
}
export interface ExcelUpdateTableParams extends ExcelTableParams {
  name?: string
  showHeaders?: boolean
  showTotals?: boolean
  style?: string
}
export interface ExcelRowParams extends ExcelTableParams {
  index: number
}
export interface ExcelUpdateRowParams extends ExcelRowParams {
  values: ExcelCellValue[][]
}
export interface ExcelCreateSessionParams extends Omit<ExcelWorkbookParams, 'sessionId'> {
  persistChanges: boolean
}
export interface ExcelSessionParams extends ExcelWorkbookParams {
  sessionId: string
}
export interface ExcelCalculateParams extends ExcelWorkbookParams {
  calculationType: 'Recalculate' | 'Full' | 'FullRebuild'
}
export interface ExcelWorksheet {
  id: string | null
  name: string | null
  position: number | null
  visibility: string | null
}
export interface ExcelTable {
  id: string | null
  name: string | null
  showHeaders: boolean | null
  showTotals: boolean | null
  style: string | null
  highlightFirstColumn: boolean | null
  highlightLastColumn: boolean | null
  showBandedColumns: boolean | null
  showBandedRows: boolean | null
  showFilterButton: boolean | null
  legacyId: string | null
}
export interface ExcelRow {
  index: number | null
  values: ExcelCellValue[][]
}
export interface ExcelWorksheetResponse extends ToolResponse {
  output: { worksheet: ExcelWorksheet }
}
export interface ExcelWorksheetsResponse extends ToolResponse {
  output: { worksheets: ExcelWorksheet[]; nextLink: string | null; count: number }
}
export interface ExcelTableResponse extends ToolResponse {
  output: { table: ExcelTable }
}
export interface ExcelTablesResponse extends ToolResponse {
  output: { tables: ExcelTable[]; nextLink: string | null; count: number }
}
export interface ExcelRowResponse extends ToolResponse {
  output: ExcelRow
}
export interface ExcelRowsResponse extends ToolResponse {
  output: { rows: ExcelRow[]; nextLink: string | null; count: number }
}
export interface ExcelDeleteResponse extends ToolResponse {
  output: { deleted: boolean }
}
export interface ExcelCreateSessionResponse extends ToolResponse {
  output: { sessionId: string; persistChanges: boolean }
}
export interface ExcelCloseSessionResponse extends ToolResponse {
  output: { closed: boolean }
}
export interface ExcelRefreshSessionResponse extends ToolResponse {
  output: { refreshed: boolean }
}
export interface ExcelCalculateResponse extends ToolResponse {
  output: { calculated: boolean }
}
