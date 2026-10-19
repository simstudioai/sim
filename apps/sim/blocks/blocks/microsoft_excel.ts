import { MicrosoftExcelIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'

/** Maps the read/write operation to its `_v2` tool id, falling back to read on unknown ops. */
const versionedReadWriteSelector = createVersionedToolSelector<Record<string, unknown>>({
  baseToolSelector: (params) => {
    switch (params.operation) {
      case 'read':
        return 'microsoft_excel_read'
      case 'write':
        return 'microsoft_excel_write'
      default:
        throw new Error(`Invalid Microsoft Excel operation: ${params.operation}`)
    }
  },
  suffix: '_v2',
  fallbackToolId: 'microsoft_excel_read_v2',
})

/** Normalizes an empty/whitespace dropdown or input value to `undefined`, otherwise a trimmed string. */
function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Leaves optional JSON unset until a populated value reaches the tool's bounded parser. */
function optionalJson(value: unknown): unknown {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
    ? undefined
    : value
}

function requiredWithoutAlternatives(
  values: Record<string, unknown> | undefined,
  operations: string[],
  alternatives: string[]
) {
  return {
    field: 'operation',
    value:
      values && alternatives.every((field) => optionalJson(values[field]) === undefined)
        ? operations
        : [],
  }
}

/** Coerces a 'true'/'false' dropdown value to boolean, or `undefined` when unset. */
function optionalBoolean(value: unknown): boolean | undefined {
  const str = optionalString(value)
  if (str === undefined) return undefined
  if (str === 'true') return true
  if (str === 'false') return false
  return undefined
}

/** Coerces a numeric input value to number, or `undefined` when unset or invalid. */
function optionalNumber(value: unknown): number | undefined {
  const str = optionalString(value)
  if (str === undefined) return undefined
  const num = Number(str)
  if (!Number.isFinite(num)) throw new Error('Expected a finite number')
  return num
}

/** Normalizes stored agent inputs when the selected operation is carried outside the parameter map. */
function normalizeExcelAgentParams(params: Record<string, unknown>, separateSheet: boolean) {
  const result: Record<string, unknown> = { ...params }
  for (const field of ['index', 'top', 'skip', 'position', 'fontSize', 'sortColumn']) {
    const value = optionalString(params[field])
    const number = value === undefined ? undefined : Number(value)
    result[field] = number === undefined || Number.isFinite(number) ? number : params[field]
  }
  for (const field of [
    'fontBold',
    'fontItalic',
    'sortAscending',
    'showHeaders',
    'showTotals',
    'rowHidden',
    'columnHidden',
  ])
    result[field] = optionalBoolean(params[field])
  for (const field of [
    'values',
    'formulas',
    'formulasLocal',
    'formulasR1C1',
    'numberFormat',
    'sortFields',
  ])
    result[field] = optionalJson(params[field])
  for (const field of [
    'sessionId',
    'name',
    'style',
    'visibility',
    'sortMethod',
    'orientation',
    'fillColor',
    'fontColor',
    'fontName',
    'fontUnderline',
  ])
    result[field] = optionalString(params[field])

  const sheetName = optionalString(params.sheetName)
  const range = optionalString(params.cellRange) ?? optionalString(params.range)
  result.range = range
  result.sheetName = sheetName
  result.tableName = optionalString(params.sortTableName) ?? optionalString(params.tableName)
  result.worksheetName = sheetName ?? optionalString(params.worksheetName)
  result.hasHeaders =
    optionalBoolean(params.tableHasHeaders) ??
    optionalBoolean(params.sortHasHeaders) ??
    optionalBoolean(params.hasHeaders)
  result.matchCase = optionalBoolean(params.sortMatchCase) ?? optionalBoolean(params.matchCase)
  result.persistChanges = optionalBoolean(params.persistChanges) ?? false
  result.address = separateSheet
    ? sheetName && range
      ? `${quoteSheetName(sheetName)}!${range}`
      : optionalString(params.address)
    : (range ?? optionalString(params.address))
  if (optionalJson(params.sortFields) !== undefined) result.sortColumn = undefined
  return result
}

/** Wraps a worksheet name in single quotes when it contains characters that require escaping in an address. */
function quoteSheetName(sheetName: string): string {
  if (/^[A-Za-z0-9_]+$/.test(sheetName)) return sheetName
  return `'${sheetName.replace(/'/g, "''")}'`
}

/** Canonical pair for the workbook: picker in basic mode, raw id in advanced. */
const SPREADSHEET_FIELD = ['spreadsheetId', 'manualSpreadsheetId'] as const

/** Canonical pair for the worksheet tab, on the `_v2` block only. */
const SHEET_FIELD = ['sheetName', 'manualSheetName'] as const

export const MicrosoftExcelBlock: BlockConfig = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel (Legacy)',
  description: 'Read, write, and update data',
  authMode: AuthMode.OAuth,
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'microsoft_excel_v2' },
  longDescription: 'Read, write, update, add to table, and create new worksheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  canvasPresentation: {
    defaultTitle: 'Microsoft Excel',
    sentences: {
      byOperation: {
        read: [
          { text: 'Read', field: 'range', core: true },
          { text: 'from', field: SPREADSHEET_FIELD, core: true },
        ],
        write: [
          { text: 'Write values to', field: SPREADSHEET_FIELD, core: true },
          { text: ', at', field: 'range' },
        ],
        table_add: [
          {
            text: 'Append rows to table',
            field: 'tableName',
            core: true,
          },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        worksheet_add: [
          { text: 'Add worksheet', field: 'worksheetName', core: true },
          { text: 'to', field: SPREADSHEET_FIELD, core: true },
        ],
        clear_range: [
          { text: 'Clear', field: 'range', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        format_range: [
          { text: 'Format', field: 'range', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        create_table: [
          { text: 'Create a table over', field: 'range', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        sort_range: [
          { text: 'Sort', field: ['sortTableName', 'range'], core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
          { text: ', by column', field: 'sortColumn' },
        ],
        delete_worksheet: [
          { text: 'Delete worksheet', field: 'worksheetName', core: true },
          { text: 'from', field: SPREADSHEET_FIELD, core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write/Update Data', id: 'write' },
        { label: 'Add to Table', id: 'table_add' },
        { label: 'Add Worksheet', id: 'worksheet_add' },
        { label: 'Clear Range', id: 'clear_range' },
        { label: 'Format Range', id: 'format_range' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Sort Range', id: 'sort_range' },
        { label: 'Delete Worksheet', id: 'delete_worksheet' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'microsoft-excel',
      requiredScopes: getScopesForService('microsoft-excel'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      required: true,
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: { all: ['credential'], any: ['credential', 'driveId'] },
      mode: 'basic',
    },
    {
      id: 'driveId',
      title: 'Drive ID (SharePoint)',
      type: 'short-input',
      placeholder: 'Leave empty for OneDrive, or enter drive ID for SharePoint',
      mode: 'advanced',
    },
    {
      id: 'manualSpreadsheetId',
      title: 'Spreadsheet ID',
      required: true,
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      placeholder: 'Enter spreadsheet ID',
      dependsOn: ['credential'],
      mode: 'advanced',
    },
    {
      id: 'range',
      title: 'Range',
      type: 'short-input',
      placeholder: 'Sheet name and cell range (e.g., Sheet1!A1:D10)',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'update',
          'clear_range',
          'format_range',
          'create_table',
          'sort_range',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'write',
          'clear_range',
          'format_range',
          'create_table',
          ...(values && !optionalString(values.sortTableName) ? ['sort_range'] : []),
        ],
      }),
      wandConfig: {
        enabled: true,
        prompt: `Generate a valid Microsoft Excel range based on the user's description.

### FORMAT (REQUIRED)
SheetName!StartCell:EndCell

Excel ALWAYS requires the full range format with both sheet name and cell range.

### RANGE RULES
- Sheet names with spaces must be quoted: 'My Sheet'!A1:B10
- Column letters are uppercase: A, B, C, ... Z, AA, AB, etc.
- Row numbers start at 1 (not 0)
- For entire columns: Sheet1!A:Z
- For entire rows: Sheet1!1:100

### EXAMPLES
- "the first sheet" -> Sheet1!A1:Z1000
- "data sheet from A1 to E100" -> 'Data Sheet'!A1:E100
- "cells A1 through C50 on Sheet2" -> Sheet2!A1:C50
- "column A of inventory" -> Inventory!A:A
- "just the headers row on Sheet1" -> Sheet1!1:1
- "all data on sales sheet" -> 'Sales'!A1:Z1000

Return ONLY the range string - no explanations, no quotes around the entire output, no extra text.`,
        placeholder: 'Describe the range (e.g., "A1 to D50 on Sheet1")...',
      },
    },
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'Name of the Excel table',
      condition: { field: 'operation', value: ['table_add'] },
      required: true,
    },
    {
      id: 'worksheetName',
      title: 'Worksheet Name',
      type: 'short-input',
      placeholder: 'Name of the worksheet (max 31 characters)',
      condition: { field: 'operation', value: ['worksheet_add', 'delete_worksheet'] },
      required: { field: 'operation', value: 'delete_worksheet' },
    },
    {
      id: 'values',
      description:
        'For Write Data, provide values or an advanced formula, number format, or visibility change. For Add Table Rows, omit values to add a blank row.',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: ['write', 'table_add'] },
      required: (values) =>
        requiredWithoutAlternatives(
          values,
          ['write'],
          ['formulas', 'formulasLocal', 'formulasR1C1', 'numberFormat', 'columnHidden', 'rowHidden']
        ),
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel data as a two-dimensional JSON array in the column order provided by the user.

Return data rows only. When adding rows to an existing table, never include a header row.
Only include headers when the user explicitly asks to write headers to a worksheet range.
Example data rows: [["Widget A", 1500], ["Widget B", 2300]]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to write...',
        generationType: 'json-object',
      },
    },
    {
      id: 'applyTo',
      title: 'Clear',
      type: 'dropdown',
      options: [
        { label: 'All (contents and formats)', id: 'All' },
        { label: 'Contents only', id: 'Contents' },
        { label: 'Formats only', id: 'Formats' },
      ],
      value: () => 'All',
      condition: { field: 'operation', value: 'clear_range' },
    },
    {
      id: 'fillColor',
      title: 'Fill Color',
      description: 'Provide a fill color or at least one font property.',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FFFF00)',
      condition: { field: 'operation', value: 'format_range' },
      required: (values) =>
        requiredWithoutAlternatives(
          values,
          ['format_range'],
          ['fontBold', 'fontItalic', 'fontColor', 'fontSize', 'fontName', 'fontUnderline']
        ),
    },
    {
      id: 'fontBold',
      title: 'Bold',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Bold', id: 'true' },
        { label: 'Not bold', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'format_range' },
    },
    {
      id: 'fontColor',
      title: 'Font Color',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FF0000)',
      condition: { field: 'operation', value: 'format_range' },
    },
    {
      id: 'fontItalic',
      title: 'Italic',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Italic', id: 'true' },
        { label: 'Not italic', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'fontSize',
      title: 'Font Size',
      type: 'short-input',
      placeholder: 'Font size in points (e.g., 12)',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'fontName',
      title: 'Font Name',
      type: 'short-input',
      placeholder: 'Font name (e.g., Calibri)',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'tableHasHeaders',
      title: 'First Row Has Headers',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'sortTableName',
      paramVisibility: 'user-or-llm',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'Optional: sort a table instead of the cell range',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'sortColumn',
      title: 'Sort Key',
      description: 'Required unless Sort Conditions are provided in advanced mode.',
      type: 'short-input',
      placeholder: 'Zero-based column or row offset (based on orientation)',
      condition: { field: 'operation', value: 'sort_range' },
      required: (values) => requiredWithoutAlternatives(values, ['sort_range'], ['sortFields']),
    },
    {
      id: 'sortAscending',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'true' },
        { label: 'Descending', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'sort_range' },
    },
    {
      id: 'sortHasHeaders',
      title: 'Range Has Header Row',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'sortMatchCase',
      title: 'Match Case',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'formulas',
      title: 'Formulas',
      type: 'code',
      placeholder: '[["=SUM(A1:A10)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'formulasLocal',
      title: 'Localized Formulas',
      type: 'code',
      placeholder: '[["=SUMME(A1;1,5)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate localized formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the localized formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'formulasR1C1',
      title: 'R1C1 Formulas',
      type: 'code',
      placeholder: '[["=SUM(R[-10]C:R[-1]C)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate r1c1 formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the r1c1 formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'numberFormat',
      title: 'Number Formats',
      type: 'code',
      placeholder: '[["0.00", "yyyy-mm-dd"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate number formats for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the number formats...',
        generationType: 'json-object',
      },
    },
    {
      id: 'columnHidden',
      title: 'Hide Columns',
      type: 'dropdown',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'rowHidden',
      title: 'Hide Rows',
      type: 'dropdown',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'fontUnderline',
      title: 'Underline',
      type: 'dropdown',
      condition: { field: 'operation', value: ['format_range'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'None', id: 'None' },
        { label: 'Single', id: 'Single' },
        { label: 'Double', id: 'Double' },
        { label: 'SingleAccountant', id: 'SingleAccountant' },
        { label: 'DoubleAccountant', id: 'DoubleAccountant' },
      ],
      value: () => '',
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Optional workbook session ID',
      mode: 'advanced',
    },
    {
      id: 'sortFields',
      title: 'Sort Conditions',
      type: 'code',
      language: 'json',
      placeholder: '[{"key":0,"ascending":true,"sortOn":"Value"}]',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Excel sort conditions with key (zero-based offset), ascending, sortOn (Value, CellColor, FontColor, Icon), optional color, dataOption (Normal, TextAsNumber), and icon ({set,index}). Return ONLY the JSON array.',
        placeholder: 'Describe how to sort the range...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sortMethod',
      title: 'Chinese Sort Method',
      type: 'dropdown',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'PinYin', id: 'PinYin' },
        { label: 'Stroke count', id: 'StrokeCount' },
      ],
    },
    {
      id: 'orientation',
      title: 'Sort Orientation',
      type: 'dropdown',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      options: [
        { label: 'Rows', id: 'Rows' },
        { label: 'Columns', id: 'Columns' },
      ],
    },
    {
      id: 'index',
      title: 'Insertion Index',
      type: 'short-input',
      placeholder: 'Omit to append, or enter a zero-based row index',
      condition: { field: 'operation', value: 'table_add' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'microsoft_excel_read',
      'microsoft_excel_write',
      'microsoft_excel_table_add',
      'microsoft_excel_worksheet_add',
      'microsoft_excel_clear_range',
      'microsoft_excel_format_range',
      'microsoft_excel_create_table',
      'microsoft_excel_delete_worksheet',
      'microsoft_excel_sort_range',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'microsoft_excel_read'
          case 'write':
            return 'microsoft_excel_write'
          case 'table_add':
            return 'microsoft_excel_table_add'
          case 'worksheet_add':
            return 'microsoft_excel_worksheet_add'
          case 'clear_range':
            return 'microsoft_excel_clear_range'
          case 'format_range':
            return 'microsoft_excel_format_range'
          case 'create_table':
            return 'microsoft_excel_create_table'
          case 'delete_worksheet':
            return 'microsoft_excel_delete_worksheet'
          case 'sort_range':
            return 'microsoft_excel_sort_range'
          default:
            throw new Error(`Invalid Microsoft Excel operation: ${params.operation}`)
        }
      },
      params: (params) => {
        if (!params.operation) return normalizeExcelAgentParams(params, false)
        const {
          oauthCredential,
          values,
          spreadsheetId,
          tableName,
          worksheetName,
          driveId,
          range,
          operation,
          applyTo,
          fillColor,
          fontBold,
          fontItalic,
          fontColor,
          fontSize,
          fontName,
          tableHasHeaders,
          sortTableName,
          sortColumn,
          sortAscending,
          sortHasHeaders,
          sortMatchCase,
          siteId: _siteId,
        } = params

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''
        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        const effectiveDriveId = driveId ? String(driveId).trim() : undefined
        const trimmedRange = optionalString(range)

        const base = {
          spreadsheetId: effectiveSpreadsheetId,
          driveId: effectiveDriveId,
          oauthCredential,
          sessionId: optionalString(params.sessionId),
        }

        switch (operation) {
          case 'clear_range':
            if (!trimmedRange) {
              throw new Error('A range is required to clear cells.')
            }
            return { ...base, range: trimmedRange, applyTo: optionalString(applyTo) }
          case 'format_range':
            if (!trimmedRange) {
              throw new Error('A range is required to format cells.')
            }
            return {
              ...base,
              range: trimmedRange,
              fillColor: optionalString(fillColor),
              fontBold: optionalBoolean(fontBold),
              fontItalic: optionalBoolean(fontItalic),
              fontColor: optionalString(fontColor),
              fontSize: optionalNumber(fontSize),
              fontName: optionalString(fontName),
              fontUnderline: optionalString(params.fontUnderline),
            }
          case 'create_table': {
            const address = trimmedRange ?? optionalString(params.address)
            if (!address) {
              throw new Error('A range is required to create a table.')
            }
            return {
              ...base,
              address,
              hasHeaders:
                optionalBoolean(tableHasHeaders) ?? optionalBoolean(params.hasHeaders) ?? true,
            }
          }
          case 'delete_worksheet': {
            const effectiveWorksheetName = worksheetName ? String(worksheetName).trim() : ''
            if (!effectiveWorksheetName) {
              throw new Error('Worksheet name is required to delete a worksheet.')
            }
            return { ...base, worksheetName: effectiveWorksheetName }
          }
          case 'sort_range': {
            const sortFields = optionalJson(params.sortFields)
            const effectiveTableName =
              optionalString(sortTableName) ?? optionalString(params.tableName)
            if (!effectiveTableName && !trimmedRange) {
              throw new Error('A range or table name is required to sort.')
            }
            return {
              ...base,
              range: trimmedRange,
              tableName: effectiveTableName,
              sortColumn: sortFields === undefined ? optionalNumber(sortColumn) : undefined,
              sortFields,
              sortMethod: optionalString(params.sortMethod),
              orientation: optionalString(params.orientation),
              sortAscending: optionalBoolean(sortAscending) ?? true,
              hasHeaders: optionalBoolean(sortHasHeaders) ?? optionalBoolean(params.hasHeaders),
              matchCase: optionalBoolean(sortMatchCase) ?? optionalBoolean(params.matchCase),
            }
          }
          case 'table_add':
            return {
              ...base,
              tableName: optionalString(tableName),
              values: optionalJson(values),
              index: optionalNumber(params.index),
            }
          case 'worksheet_add':
            return { ...base, worksheetName: optionalString(worksheetName) }
          case 'read':
            return { ...base, range: trimmedRange }
          case 'write':
            return {
              ...base,
              range: trimmedRange,
              values: optionalJson(values),
              formulas: optionalJson(params.formulas),
              formulasLocal: optionalJson(params.formulasLocal),
              formulasR1C1: optionalJson(params.formulasR1C1),
              numberFormat: optionalJson(params.numberFormat),
              columnHidden: optionalBoolean(params.columnHidden),
              rowHidden: optionalBoolean(params.rowHidden),
            }
          default:
            throw new Error(`Invalid Microsoft Excel operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    sortFields: { type: 'json', description: 'Sort Conditions' },
    sortMethod: { type: 'string', description: 'Chinese Sort Method' },
    orientation: { type: 'string', description: 'Sort Orientation' },
    index: { type: 'string', description: 'Insertion Index' },
    sessionId: { type: 'string', description: 'Workbook session ID' },
    formulas: { type: 'json', description: 'Formulas' },
    formulasLocal: { type: 'json', description: 'Localized Formulas' },
    formulasR1C1: { type: 'json', description: 'R1C1 Formulas' },
    numberFormat: { type: 'json', description: 'Number Formats' },
    columnHidden: { type: 'string', description: 'Hide Columns' },
    rowHidden: { type: 'string', description: 'Hide Rows' },
    fontUnderline: { type: 'string', description: 'Underline' },
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Microsoft Excel access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    driveId: { type: 'string', description: 'Drive ID for SharePoint document libraries' },
    range: { type: 'string', description: 'Cell range' },
    tableName: { type: 'string', description: 'Table name' },
    worksheetName: { type: 'string', description: 'Worksheet name' },
    values: { type: 'string', description: 'Cell values data' },
    applyTo: { type: 'string', description: 'What to clear (All, Contents, Formats)' },
    fillColor: { type: 'string', description: 'Background fill color' },
    fontBold: { type: 'string', description: 'Bold font toggle' },
    fontItalic: { type: 'string', description: 'Italic font toggle' },
    fontColor: { type: 'string', description: 'Font color' },
    fontSize: { type: 'string', description: 'Font size in points' },
    fontName: { type: 'string', description: 'Font name' },
    tableHasHeaders: { type: 'string', description: 'Whether the table range has a header row' },
    sortTableName: { type: 'string', description: 'Table name to sort (optional)' },
    sortColumn: { type: 'string', description: 'Zero-based column or row offset to sort on' },
    sortAscending: { type: 'string', description: 'Sort order (ascending/descending)' },
    sortHasHeaders: { type: 'string', description: 'Whether the range has a header row' },
    sortMatchCase: { type: 'string', description: 'Whether casing affects ordering' },
  },
  outputs: {
    data: { type: 'json', description: 'Excel range data with sheet information and cell values' },
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID, URL, and sheet details',
    },
    updatedRange: { type: 'string', description: 'The range that was updated (write operations)' },
    updatedRows: { type: 'number', description: 'Number of rows updated (write operations)' },
    updatedColumns: { type: 'number', description: 'Number of columns updated (write operations)' },
    updatedCells: {
      type: 'number',
      description: 'Total number of cells updated (write operations)',
    },
    index: { type: 'number', description: 'Row index for table add operations' },
    values: { type: 'json', description: 'Cell values array for write and table add operations' },
    worksheet: {
      type: 'json',
      description: 'Details of the newly created worksheet (worksheet_add operations)',
    },
    cleared: { type: 'boolean', description: 'Whether the range was cleared (clear_range)' },
    applyTo: { type: 'string', description: 'What was cleared (clear_range)' },
    formatted: { type: 'boolean', description: 'Whether formatting was applied (format_range)' },
    fill: { type: 'json', description: 'Applied fill ({color}) or null (format_range)' },
    font: {
      type: 'json',
      description: 'Applied font ({bold, italic, color, name, size}) or null (format_range)',
    },
    table: {
      type: 'json',
      description: 'Created table ({id, name, showHeaders, showTotals, style}) (create_table)',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the worksheet was deleted (delete_worksheet)',
    },
    worksheetName: {
      type: 'string',
      description: 'Name of the deleted worksheet (delete_worksheet)',
    },
    sorted: { type: 'boolean', description: 'Whether the sort was applied (sort_range)' },
    target: { type: 'string', description: 'The range or table name that was sorted (sort_range)' },
  },
}

export const MicrosoftExcelV2Block: BlockConfig = {
  type: 'microsoft_excel_v2',
  name: 'Microsoft Excel',
  description: 'Manage worksheets, tables, rows, and workbook sessions',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  longDescription:
    'Read and write values and formulas, manage worksheets and table rows, format ranges, and calculate workbooks with persistent or temporary sessions.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  canvasPresentation: {
    defaultTitle: 'Microsoft Excel',
    sentences: {
      byOperation: {
        table_add: ['Add Table Rows', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        worksheet_add: ['Add Worksheet', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        list_worksheets: ['List Worksheets', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        get_worksheet: ['Get Worksheet', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        update_worksheet: [
          'Update Worksheet',
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        list_tables: ['List Tables', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        get_table: ['Get Table', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        update_table: ['Update Table', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        delete_table: ['Delete Table', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        list_table_rows: ['List Table Rows', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        get_table_row: ['Get Table Row', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        update_table_row: [
          'Update Table Row',
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        delete_table_row: [
          'Delete Table Row',
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        create_session: ['Create Session', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        refresh_session: ['Refresh Session', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        close_session: ['Close Session', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        calculate: ['Calculate Workbook', { text: 'in', field: SPREADSHEET_FIELD, core: true }],
        read: [
          { text: 'Read', field: 'cellRange', core: true },
          { text: 'from', field: SPREADSHEET_FIELD, core: true },
          { text: ', sheet', field: SHEET_FIELD },
        ],
        write: [
          { text: 'Write values to', field: SPREADSHEET_FIELD, core: true },
          { text: ', sheet', field: SHEET_FIELD },
          { text: ', at', field: 'cellRange' },
        ],
        clear_range: [
          { text: 'Clear', field: 'cellRange', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
          { text: ', sheet', field: SHEET_FIELD },
        ],
        format_range: [
          { text: 'Format', field: 'cellRange', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
          { text: ', sheet', field: SHEET_FIELD },
        ],
        create_table: [
          { text: 'Create a table over', field: 'cellRange', core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
        ],
        sort_range: [
          { text: 'Sort', field: ['tableName', 'cellRange'], core: true },
          { text: 'in', field: SPREADSHEET_FIELD, core: true },
          { text: ', by column', field: 'sortColumn' },
        ],
        delete_worksheet: [
          { text: 'Delete sheet', field: SHEET_FIELD, core: true },
          { text: 'from', field: SPREADSHEET_FIELD, core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write Data', id: 'write' },
        { label: 'Clear Range', id: 'clear_range' },
        { label: 'Format Range', id: 'format_range' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Sort Range', id: 'sort_range' },
        { label: 'Delete Worksheet', id: 'delete_worksheet' },
        { label: 'Add Table Rows', id: 'table_add' },
        { label: 'Add Worksheet', id: 'worksheet_add' },
        { label: 'List Worksheets', id: 'list_worksheets' },
        { label: 'Get Worksheet', id: 'get_worksheet' },
        { label: 'Update Worksheet', id: 'update_worksheet' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'Get Table', id: 'get_table' },
        { label: 'Update Table', id: 'update_table' },
        { label: 'Delete Table', id: 'delete_table' },
        { label: 'List Table Rows', id: 'list_table_rows' },
        { label: 'Get Table Row', id: 'get_table_row' },
        { label: 'Update Table Row', id: 'update_table_row' },
        { label: 'Delete Table Row', id: 'delete_table_row' },
        { label: 'Create Session', id: 'create_session' },
        { label: 'Refresh Session', id: 'refresh_session' },
        { label: 'Close Session', id: 'close_session' },
        { label: 'Calculate Workbook', id: 'calculate' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'microsoft-excel',
      requiredScopes: getScopesForService('microsoft-excel'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'fileSource',
      title: 'File Source',
      type: 'dropdown',
      options: [
        { label: 'OneDrive', id: 'onedrive' },
        { label: 'SharePoint', id: 'sharepoint' },
      ],
      value: () => 'onedrive',
    },
    {
      id: 'siteSelector',
      title: 'SharePoint Site',
      type: 'file-selector',
      canonicalParamId: 'siteId',
      serviceId: 'sharepoint',
      selectorKey: 'sharepoint.sites',
      requiredScopes: [],
      placeholder: 'Select a SharePoint site',
      dependsOn: ['credential', 'fileSource'],
      condition: { field: 'fileSource', value: 'sharepoint' },
      required: { field: 'fileSource', value: 'sharepoint' },
      mode: 'basic',
    },
    {
      id: 'driveSelector',
      title: 'Document Library',
      type: 'file-selector',
      canonicalParamId: 'driveId',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel.drives',
      placeholder: 'Select a document library',
      dependsOn: ['credential', 'siteSelector', 'fileSource'],
      condition: { field: 'fileSource', value: 'sharepoint' },
      required: { field: 'fileSource', value: 'sharepoint' },
      mode: 'basic',
    },
    {
      id: 'spreadsheetId',
      title: 'Select Spreadsheet',
      required: true,
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: { all: ['credential', 'fileSource'], any: ['credential', 'driveSelector'] },
      mode: 'basic',
    },
    {
      id: 'manualDriveId',
      title: 'Drive ID',
      type: 'short-input',
      canonicalParamId: 'driveId',
      placeholder: 'Enter the SharePoint drive ID',
      condition: { field: 'fileSource', value: 'sharepoint' },
      dependsOn: ['fileSource'],
      required: { field: 'fileSource', value: 'sharepoint' },
      mode: 'advanced',
    },
    {
      id: 'manualSpreadsheetId',
      title: 'Spreadsheet ID',
      required: true,
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      placeholder: 'Enter spreadsheet ID',
      dependsOn: { all: ['credential'], any: ['credential', 'manualDriveId'] },
      mode: 'advanced',
    },
    {
      id: 'sheetName',
      title: 'Sheet (Tab)',
      type: 'sheet-selector',
      canonicalParamId: 'sheetName',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel.sheets',
      placeholder: 'Select a sheet',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'clear_range',
          'format_range',
          'create_table',
          'sort_range',
          'delete_worksheet',
          'get_worksheet',
          'update_worksheet',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'read',
          'write',
          'clear_range',
          'format_range',
          'create_table',
          'delete_worksheet',
          'get_worksheet',
          'update_worksheet',
          ...(values && !optionalString(values.tableName) && !optionalString(values.sortTableName)
            ? ['sort_range']
            : []),
        ],
      }),
      dependsOn: {
        all: ['credential'],
        any: ['spreadsheetId', 'manualSpreadsheetId', 'driveSelector'],
      },
      mode: 'basic',
    },
    {
      id: 'manualSheetName',
      title: 'Sheet Name',
      type: 'short-input',
      canonicalParamId: 'sheetName',
      placeholder: 'Name of the sheet/tab (e.g., Sheet1)',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'clear_range',
          'format_range',
          'create_table',
          'sort_range',
          'delete_worksheet',
          'get_worksheet',
          'update_worksheet',
        ],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'read',
          'write',
          'clear_range',
          'format_range',
          'create_table',
          'delete_worksheet',
          'get_worksheet',
          'update_worksheet',
          ...(values && !optionalString(values.tableName) && !optionalString(values.sortTableName)
            ? ['sort_range']
            : []),
        ],
      }),
      dependsOn: {
        all: ['credential'],
        any: ['credential', 'manualDriveId'],
      },
      mode: 'advanced',
    },
    {
      id: 'cellRange',
      title: 'Cell Range',
      type: 'short-input',
      placeholder: 'Cell range (e.g., A1:D10). Defaults to used range for read, A1 for write.',
      condition: {
        field: 'operation',
        value: ['read', 'write', 'clear_range', 'format_range', 'create_table', 'sort_range'],
      },
      required: (values) => ({
        field: 'operation',
        value: [
          'clear_range',
          'format_range',
          'create_table',
          ...(values && !optionalString(values.tableName) && !optionalString(values.sortTableName)
            ? ['sort_range']
            : []),
        ],
      }),
      wandConfig: {
        enabled: true,
        prompt: `Generate a valid cell range based on the user's description.

### VALID FORMATS
- Single cell: A1
- Range: A1:D10
- Entire column: A:A
- Entire row: 1:1
- Multiple columns: A:D
- Multiple rows: 1:10

### RANGE RULES
- Column letters are uppercase: A, B, C, ... Z, AA, AB, etc.
- Row numbers start at 1 (not 0)

### EXAMPLES
- "first 100 rows" -> A1:Z100
- "cells A1 through C50" -> A1:C50
- "column A" -> A:A
- "just the headers row" -> 1:1
- "first cell" -> A1

Return ONLY the range string - no sheet name, no explanations, no quotes.`,
        placeholder: 'Describe the range (e.g., "first 50 rows" or "column A")...',
      },
    },
    {
      id: 'values',
      description:
        'For Write Data, provide values or an advanced formula, number format, or visibility change. For Add Table Rows, omit values to add a blank row. For Update Table Row, provide exactly one 2D array row in table column order, without headers or object keys; null leaves a cell unchanged.',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}])',
      condition: { field: 'operation', value: ['write', 'table_add', 'update_table_row'] },
      required: (values) => ({
        field: 'operation',
        value: [
          'update_table_row',
          ...requiredWithoutAlternatives(
            values,
            ['write'],
            [
              'formulas',
              'formulasLocal',
              'formulasR1C1',
              'numberFormat',
              'columnHidden',
              'rowHidden',
            ]
          ).value,
        ],
      }),
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel data as a two-dimensional JSON array in the column order provided by the user.

Return data rows only. For Update Table Row, return exactly one row in table column order, without headers or object keys; use null for cells that should remain unchanged.
When adding rows to an existing table, never include a header row.
Only include headers when the user explicitly asks to write headers to a worksheet range.
Example data rows: [["Widget A", 1500], ["Widget B", 2300]]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to write...',
        generationType: 'json-object',
      },
    },
    {
      id: 'applyTo',
      title: 'Clear',
      type: 'dropdown',
      options: [
        { label: 'All (contents and formats)', id: 'All' },
        { label: 'Contents only', id: 'Contents' },
        { label: 'Formats only', id: 'Formats' },
      ],
      value: () => 'All',
      condition: { field: 'operation', value: 'clear_range' },
    },
    {
      id: 'fillColor',
      title: 'Fill Color',
      description: 'Provide a fill color or at least one font property.',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FFFF00)',
      condition: { field: 'operation', value: 'format_range' },
      required: (values) =>
        requiredWithoutAlternatives(
          values,
          ['format_range'],
          ['fontBold', 'fontItalic', 'fontColor', 'fontSize', 'fontName', 'fontUnderline']
        ),
    },
    {
      id: 'fontBold',
      title: 'Bold',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Bold', id: 'true' },
        { label: 'Not bold', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'format_range' },
    },
    {
      id: 'fontColor',
      title: 'Font Color',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FF0000)',
      condition: { field: 'operation', value: 'format_range' },
    },
    {
      id: 'fontItalic',
      title: 'Italic',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Italic', id: 'true' },
        { label: 'Not italic', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'fontSize',
      title: 'Font Size',
      type: 'short-input',
      placeholder: 'Font size in points (e.g., 12)',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'fontName',
      title: 'Font Name',
      type: 'short-input',
      placeholder: 'Font name (e.g., Calibri)',
      condition: { field: 'operation', value: 'format_range' },
      mode: 'advanced',
    },
    {
      id: 'tableHasHeaders',
      title: 'First Row Has Headers',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'sortColumn',
      title: 'Sort Key',
      description: 'Required unless Sort Conditions are provided in advanced mode.',
      type: 'short-input',
      placeholder: 'Zero-based column or row offset (based on orientation)',
      condition: { field: 'operation', value: 'sort_range' },
      required: (values) => requiredWithoutAlternatives(values, ['sort_range'], ['sortFields']),
    },
    {
      id: 'sortAscending',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'true' },
        { label: 'Descending', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'sort_range' },
    },
    {
      id: 'sortHasHeaders',
      title: 'Range Has Header Row',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'sortMatchCase',
      title: 'Match Case',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'formulas',
      title: 'Formulas',
      type: 'code',
      placeholder: '[["=SUM(A1:A10)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'formulasLocal',
      title: 'Localized Formulas',
      type: 'code',
      placeholder: '[["=SUMME(A1;1,5)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate localized formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the localized formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'formulasR1C1',
      title: 'R1C1 Formulas',
      type: 'code',
      placeholder: '[["=SUM(R[-10]C:R[-1]C)"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate r1c1 formulas for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the r1c1 formulas...',
        generationType: 'json-object',
      },
    },
    {
      id: 'numberFormat',
      title: 'Number Formats',
      type: 'code',
      placeholder: '[["0.00", "yyyy-mm-dd"]]',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt: 'Generate number formats for Microsoft Excel. Return ONLY the JSON array.',
        placeholder: 'Describe the number formats...',
        generationType: 'json-object',
      },
    },
    {
      id: 'columnHidden',
      title: 'Hide Columns',
      type: 'dropdown',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'rowHidden',
      title: 'Hide Rows',
      type: 'dropdown',
      condition: { field: 'operation', value: ['write'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'fontUnderline',
      title: 'Underline',
      type: 'dropdown',
      condition: { field: 'operation', value: ['format_range'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'None', id: 'None' },
        { label: 'Single', id: 'Single' },
        { label: 'Double', id: 'Double' },
        { label: 'SingleAccountant', id: 'SingleAccountant' },
        { label: 'DoubleAccountant', id: 'DoubleAccountant' },
      ],
      value: () => '',
    },
    {
      id: 'tableName',
      title: 'Table ID or Name',
      type: 'short-input',
      placeholder: 'Table1',
      description: 'For Sort Range, provide a table name or a worksheet and cell range.',
      condition: {
        field: 'operation',
        value: [
          'sort_range',
          'table_add',
          'get_table',
          'update_table',
          'delete_table',
          'list_table_rows',
          'get_table_row',
          'update_table_row',
          'delete_table_row',
        ],
      },
      required: { field: 'operation', value: 'sort_range', not: true },
    },
    {
      id: 'worksheetName',
      title: 'New Worksheet Name',
      type: 'short-input',
      placeholder: 'Leave empty for an automatic name',
      condition: { field: 'operation', value: ['worksheet_add'] },
    },
    {
      id: 'name',
      title: 'New Name',
      description: 'Provide a new name or at least one property to update in advanced mode.',
      type: 'short-input',
      placeholder: 'Enter the new name',
      condition: { field: 'operation', value: ['update_worksheet', 'update_table'] },
      required: (values) =>
        requiredWithoutAlternatives(
          values,
          ['update_worksheet', 'update_table'],
          values?.operation === 'update_worksheet'
            ? ['position', 'visibility']
            : ['showHeaders', 'showTotals', 'style']
        ),
    },
    {
      id: 'position',
      title: 'Worksheet Position',
      type: 'short-input',
      placeholder: 'Zero-based position, such as 0',
      condition: { field: 'operation', value: ['update_worksheet'] },
      mode: 'advanced',
    },
    {
      id: 'visibility',
      title: 'Worksheet Visibility',
      type: 'dropdown',
      condition: { field: 'operation', value: ['update_worksheet'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Visible', id: 'Visible' },
        { label: 'Hidden', id: 'Hidden' },
        { label: 'VeryHidden', id: 'VeryHidden' },
      ],
      value: () => '',
    },
    {
      id: 'index',
      title: 'Row Index',
      type: 'short-input',
      placeholder: 'Zero-based index; omit for Add Table Rows to append',
      condition: {
        field: 'operation',
        value: ['table_add', 'get_table_row', 'update_table_row', 'delete_table_row'],
      },
      required: {
        field: 'operation',
        value: ['get_table_row', 'update_table_row', 'delete_table_row'],
      },
    },
    {
      id: 'top',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Default: 100; maximum: 1000',
      condition: {
        field: 'operation',
        value: ['list_worksheets', 'list_tables', 'list_table_rows'],
      },
      mode: 'advanced',
    },
    {
      id: 'skip',
      title: 'Skip',
      type: 'short-input',
      placeholder: 'Default: 0; increase by page count',
      condition: {
        field: 'operation',
        value: ['list_worksheets', 'list_tables', 'list_table_rows'],
      },
      mode: 'advanced',
    },
    {
      id: 'style',
      title: 'Table Style',
      type: 'short-input',
      placeholder: 'TableStyleMedium2',
      condition: { field: 'operation', value: ['update_table'] },
      mode: 'advanced',
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Session ID from Create Session; optional for other operations',
      condition: {
        field: 'operation',
        value: [
          'table_add',
          'worksheet_add',
          'list_worksheets',
          'get_worksheet',
          'update_worksheet',
          'list_tables',
          'get_table',
          'update_table',
          'delete_table',
          'list_table_rows',
          'get_table_row',
          'update_table_row',
          'delete_table_row',
          'refresh_session',
          'close_session',
          'calculate',
          'read',
          'write',
          'clear_range',
          'format_range',
          'create_table',
          'sort_range',
          'delete_worksheet',
        ],
      },
      required: { field: 'operation', value: ['refresh_session', 'close_session'] },
    },
    {
      id: 'persistChanges',
      title: 'Save Changes',
      type: 'switch',
      condition: { field: 'operation', value: ['create_session'] },
      required: true,
      defaultValue: false,
    },
    {
      id: 'calculationType',
      title: 'Calculation Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['calculate'] },
      required: true,
      options: [
        { label: 'Recalculate dirty cells', id: 'Recalculate' },
        { label: 'Full calculation', id: 'Full' },
        { label: 'Rebuild dependencies and calculate', id: 'FullRebuild' },
      ],
      value: () => 'Recalculate',
    },
    {
      id: 'showHeaders',
      title: 'Show Header Row',
      type: 'dropdown',
      condition: { field: 'operation', value: ['update_table'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'showTotals',
      title: 'Show Totals Row',
      type: 'dropdown',
      condition: { field: 'operation', value: ['update_table'] },
      mode: 'advanced',
      options: [
        { label: 'No change', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'sortFields',
      title: 'Sort Conditions',
      type: 'code',
      language: 'json',
      placeholder: '[{"key":0,"ascending":true,"sortOn":"Value"}]',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Excel sort conditions with key (zero-based offset), ascending, sortOn (Value, CellColor, FontColor, Icon), optional color, dataOption (Normal, TextAsNumber), and icon ({set,index}). Return ONLY the JSON array.',
        placeholder: 'Describe how to sort the range...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sortMethod',
      title: 'Chinese Sort Method',
      type: 'dropdown',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'PinYin', id: 'PinYin' },
        { label: 'Stroke count', id: 'StrokeCount' },
      ],
    },
    {
      id: 'orientation',
      title: 'Sort Orientation',
      type: 'dropdown',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
      options: [
        { label: 'Rows', id: 'Rows' },
        { label: 'Columns', id: 'Columns' },
      ],
    },
  ],
  tools: {
    access: [
      'microsoft_excel_table_add',
      'microsoft_excel_worksheet_add',
      'microsoft_excel_list_worksheets',
      'microsoft_excel_get_worksheet',
      'microsoft_excel_update_worksheet',
      'microsoft_excel_list_tables',
      'microsoft_excel_get_table',
      'microsoft_excel_update_table',
      'microsoft_excel_delete_table',
      'microsoft_excel_list_table_rows',
      'microsoft_excel_get_table_row',
      'microsoft_excel_update_table_row',
      'microsoft_excel_delete_table_row',
      'microsoft_excel_create_session',
      'microsoft_excel_refresh_session',
      'microsoft_excel_close_session',
      'microsoft_excel_calculate',
      'microsoft_excel_read_v2',
      'microsoft_excel_write_v2',
      'microsoft_excel_clear_range',
      'microsoft_excel_format_range',
      'microsoft_excel_create_table',
      'microsoft_excel_delete_worksheet',
      'microsoft_excel_sort_range',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'table_add':
            return 'microsoft_excel_table_add'
          case 'worksheet_add':
            return 'microsoft_excel_worksheet_add'
          case 'list_worksheets':
            return 'microsoft_excel_list_worksheets'
          case 'get_worksheet':
            return 'microsoft_excel_get_worksheet'
          case 'update_worksheet':
            return 'microsoft_excel_update_worksheet'
          case 'list_tables':
            return 'microsoft_excel_list_tables'
          case 'get_table':
            return 'microsoft_excel_get_table'
          case 'update_table':
            return 'microsoft_excel_update_table'
          case 'delete_table':
            return 'microsoft_excel_delete_table'
          case 'list_table_rows':
            return 'microsoft_excel_list_table_rows'
          case 'get_table_row':
            return 'microsoft_excel_get_table_row'
          case 'update_table_row':
            return 'microsoft_excel_update_table_row'
          case 'delete_table_row':
            return 'microsoft_excel_delete_table_row'
          case 'create_session':
            return 'microsoft_excel_create_session'
          case 'refresh_session':
            return 'microsoft_excel_refresh_session'
          case 'close_session':
            return 'microsoft_excel_close_session'
          case 'calculate':
            return 'microsoft_excel_calculate'
          case 'clear_range':
            return 'microsoft_excel_clear_range'
          case 'format_range':
            return 'microsoft_excel_format_range'
          case 'create_table':
            return 'microsoft_excel_create_table'
          case 'delete_worksheet':
            return 'microsoft_excel_delete_worksheet'
          case 'sort_range':
            return 'microsoft_excel_sort_range'
          default:
            return versionedReadWriteSelector(params)
        }
      },
      params: (params) => {
        if (!params.operation) return normalizeExcelAgentParams(params, true)
        const {
          oauthCredential,
          values,
          spreadsheetId,
          sheetName,
          cellRange,
          driveId,
          siteId: _siteId,
          fileSource: _fileSource,
          operation,
          applyTo,
          fillColor,
          fontBold,
          fontItalic,
          fontColor,
          fontSize,
          fontName,
          tableHasHeaders,
          sortTableName,
          sortColumn,
          sortAscending,
          sortHasHeaders,
          sortMatchCase,
        } = params

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''
        const effectiveSheetName = sheetName ? String(sheetName).trim() : ''
        const effectiveDriveId = driveId ? String(driveId).trim() : undefined
        const trimmedRange = optionalString(cellRange) ?? optionalString(params.range)

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        const base = {
          spreadsheetId: effectiveSpreadsheetId,
          driveId: effectiveDriveId,
          oauthCredential,
          sessionId: optionalString(params.sessionId),
        }

        switch (operation) {
          case 'table_add':
            return {
              ...base,
              tableName: optionalString(params.tableName),
              values: optionalJson(values),
              index: optionalNumber(params.index),
            }
          case 'worksheet_add':
            return { ...base, worksheetName: optionalString(params.worksheetName) }
          case 'list_worksheets':
          case 'list_tables':
            return { ...base, top: optionalNumber(params.top), skip: optionalNumber(params.skip) }
          case 'get_worksheet':
            return { ...base, sheetName: effectiveSheetName }
          case 'update_worksheet':
            return {
              ...base,
              sheetName: effectiveSheetName,
              name: optionalString(params.name),
              position: optionalNumber(params.position),
              visibility: optionalString(params.visibility),
            }
          case 'get_table':
          case 'delete_table':
            return { ...base, tableName: optionalString(params.tableName) }
          case 'update_table':
            return {
              ...base,
              tableName: optionalString(params.tableName),
              name: optionalString(params.name),
              showHeaders: optionalBoolean(params.showHeaders),
              showTotals: optionalBoolean(params.showTotals),
              style: optionalString(params.style),
            }
          case 'list_table_rows':
            return {
              ...base,
              tableName: optionalString(params.tableName),
              top: optionalNumber(params.top),
              skip: optionalNumber(params.skip),
            }
          case 'get_table_row':
          case 'delete_table_row':
            return {
              ...base,
              tableName: optionalString(params.tableName),
              index: optionalNumber(params.index),
            }
          case 'update_table_row':
            return {
              ...base,
              tableName: optionalString(params.tableName),
              index: optionalNumber(params.index),
              values: optionalJson(values),
            }
          case 'create_session':
            return { ...base, persistChanges: optionalBoolean(params.persistChanges) ?? false }
          case 'refresh_session':
          case 'close_session':
            return base
          case 'calculate':
            return { ...base, calculationType: params.calculationType }

          case 'clear_range':
            return {
              ...base,
              sheetName: effectiveSheetName || undefined,
              range: trimmedRange,
              applyTo: optionalString(applyTo),
            }
          case 'format_range':
            return {
              ...base,
              sheetName: effectiveSheetName || undefined,
              range: trimmedRange,
              fillColor: optionalString(fillColor),
              fontBold: optionalBoolean(fontBold),
              fontItalic: optionalBoolean(fontItalic),
              fontColor: optionalString(fontColor),
              fontSize: optionalNumber(fontSize),
              fontName: optionalString(fontName),
              fontUnderline: optionalString(params.fontUnderline),
            }
          case 'create_table': {
            const address =
              effectiveSheetName && trimmedRange
                ? `${quoteSheetName(effectiveSheetName)}!${trimmedRange}`
                : optionalString(params.address)
            if (!address) {
              throw new Error('Provide a table address or a sheet name and cell range.')
            }
            return {
              ...base,
              address,
              hasHeaders:
                optionalBoolean(tableHasHeaders) ?? optionalBoolean(params.hasHeaders) ?? true,
            }
          }
          case 'delete_worksheet': {
            const worksheetName = effectiveSheetName || optionalString(params.worksheetName)
            if (!worksheetName) {
              throw new Error('Sheet name is required to delete a worksheet.')
            }
            return { ...base, worksheetName }
          }
          case 'sort_range': {
            const sortFields = optionalJson(params.sortFields)
            const tableName = optionalString(sortTableName) ?? optionalString(params.tableName)
            if (!tableName && !trimmedRange) {
              throw new Error('A cell range or table name is required to sort.')
            }
            return {
              ...base,
              sheetName: effectiveSheetName || undefined,
              range: trimmedRange,
              tableName,
              sortColumn: sortFields === undefined ? optionalNumber(sortColumn) : undefined,
              sortFields,
              sortMethod: optionalString(params.sortMethod),
              orientation: optionalString(params.orientation),
              sortAscending: optionalBoolean(sortAscending) ?? true,
              hasHeaders: optionalBoolean(sortHasHeaders) ?? optionalBoolean(params.hasHeaders),
              matchCase: optionalBoolean(sortMatchCase) ?? optionalBoolean(params.matchCase),
            }
          }
          case 'read':
          case 'write': {
            if (!effectiveSheetName) {
              throw new Error('Sheet name is required. Please select or enter a sheet name.')
            }
            const rangeParams = { ...base, sheetName: effectiveSheetName, cellRange: trimmedRange }
            if (operation === 'read') return rangeParams
            return {
              ...rangeParams,
              values: optionalJson(values),
              formulas: optionalJson(params.formulas),
              formulasLocal: optionalJson(params.formulasLocal),
              formulasR1C1: optionalJson(params.formulasR1C1),
              numberFormat: optionalJson(params.numberFormat),
              columnHidden: optionalBoolean(params.columnHidden),
              rowHidden: optionalBoolean(params.rowHidden),
            }
          }
          default:
            throw new Error(`Invalid Microsoft Excel operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    sortFields: { type: 'json', description: 'Sort Conditions' },
    sortMethod: { type: 'string', description: 'Chinese Sort Method' },
    orientation: { type: 'string', description: 'Sort Orientation' },
    tableName: { type: 'string', description: 'Table ID or Name' },
    worksheetName: { type: 'string', description: 'New Worksheet Name' },
    name: { type: 'string', description: 'New Name' },
    position: { type: 'string', description: 'Worksheet Position' },
    visibility: { type: 'string', description: 'Worksheet Visibility' },
    index: { type: 'string', description: 'Row Index' },
    top: { type: 'string', description: 'Page Size' },
    skip: { type: 'string', description: 'Skip' },
    style: { type: 'string', description: 'Table Style' },
    sessionId: { type: 'string', description: 'Session ID' },
    persistChanges: { type: 'boolean', description: 'Save Changes' },
    calculationType: { type: 'string', description: 'Calculation Type' },
    showHeaders: { type: 'string', description: 'Show Header Row' },
    showTotals: { type: 'string', description: 'Show Totals Row' },
    formulas: { type: 'json', description: 'Formulas' },
    formulasLocal: { type: 'json', description: 'Localized Formulas' },
    formulasR1C1: { type: 'json', description: 'R1C1 Formulas' },
    numberFormat: { type: 'json', description: 'Number Formats' },
    columnHidden: { type: 'string', description: 'Hide Columns' },
    rowHidden: { type: 'string', description: 'Hide Rows' },
    fontUnderline: { type: 'string', description: 'Underline' },
    operation: { type: 'string', description: 'Operation to perform' },
    fileSource: { type: 'string', description: 'File source (onedrive or sharepoint)' },
    oauthCredential: { type: 'string', description: 'Microsoft Excel access token' },
    siteId: { type: 'string', description: 'SharePoint site ID (used for drive/file browsing)' },
    driveId: { type: 'string', description: 'Drive ID for SharePoint document libraries' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    sheetName: { type: 'string', description: 'Name of the sheet/tab (canonical param)' },
    cellRange: { type: 'string', description: 'Cell range (e.g., A1:D10)' },
    values: { type: 'string', description: 'Cell values data' },
    applyTo: { type: 'string', description: 'What to clear (All, Contents, Formats)' },
    fillColor: { type: 'string', description: 'Background fill color' },
    fontBold: { type: 'string', description: 'Bold font toggle' },
    fontItalic: { type: 'string', description: 'Italic font toggle' },
    fontColor: { type: 'string', description: 'Font color' },
    fontSize: { type: 'string', description: 'Font size in points' },
    fontName: { type: 'string', description: 'Font name' },
    tableHasHeaders: { type: 'string', description: 'Whether the table range has a header row' },
    sortColumn: { type: 'string', description: 'Zero-based column or row offset to sort on' },
    sortAscending: { type: 'string', description: 'Sort order (ascending/descending)' },
    sortHasHeaders: { type: 'string', description: 'Whether the range has a header row' },
    sortMatchCase: { type: 'string', description: 'Whether casing affects ordering' },
  },
  outputs: {
    addressLocal: {
      type: 'string',
      description: 'Range property: addressLocal',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    cellCount: {
      type: 'number',
      description: 'Range property: cellCount',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    columnCount: {
      type: 'number',
      description: 'Range property: columnCount',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    columnHidden: {
      type: 'boolean',
      description: 'Range property: columnHidden',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    columnIndex: {
      type: 'number',
      description: 'Range property: columnIndex',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    formulas: {
      type: 'json',
      description: 'Two-dimensional cell matrix: formulas',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    formulasLocal: {
      type: 'json',
      description: 'Two-dimensional cell matrix: formulasLocal',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    formulasR1C1: {
      type: 'json',
      description: 'Two-dimensional cell matrix: formulasR1C1',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    hidden: {
      type: 'boolean',
      description: 'Range property: hidden',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    numberFormat: {
      type: 'json',
      description: 'Two-dimensional cell matrix: numberFormat',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    rowCount: {
      type: 'number',
      description: 'Range property: rowCount',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    rowHidden: {
      type: 'boolean',
      description: 'Range property: rowHidden',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    rowIndex: {
      type: 'number',
      description: 'Range property: rowIndex',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    text: {
      type: 'json',
      description: 'Two-dimensional cell matrix: text',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    valueTypes: {
      type: 'json',
      description: 'Two-dimensional cell matrix: valueTypes',
      condition: { field: 'operation', value: ['read', 'write'] },
    },
    worksheet: {
      type: 'json',
      description: 'Worksheet properties (id, name, position, visibility)',
    },
    worksheets: { type: 'json', description: 'Worksheet page [{id, name, position, visibility}]' },
    tables: {
      type: 'json',
      description:
        'Table page with IDs, names, styles, header/totals visibility, and formatting flags',
    },
    rows: { type: 'json', description: 'Table row page [{index, values}]' },
    index: { type: 'number', description: 'Zero-based table row index' },
    nextLink: { type: 'string', description: 'Provider continuation link when returned' },
    count: { type: 'number', description: 'Number of items returned in this page' },
    sessionId: { type: 'string', description: 'Created workbook session ID' },
    persistChanges: { type: 'boolean', description: 'Whether session changes are saved' },
    closed: { type: 'boolean', description: 'Whether the session was closed' },
    refreshed: { type: 'boolean', description: 'Whether the session was refreshed' },
    calculated: { type: 'boolean', description: 'Whether workbook calculation completed' },
    sheetName: {
      type: 'string',
      description: 'Name of the sheet',
      condition: { field: 'operation', value: 'read' },
    },
    range: {
      type: 'string',
      description: 'Range that was read',
      condition: { field: 'operation', value: 'read' },
    },
    values: {
      type: 'json',
      description: 'Cell values as a two-dimensional array',
      condition: {
        field: 'operation',
        value: ['read', 'write', 'table_add', 'get_table_row', 'update_table_row'],
      },
    },
    updatedRange: {
      type: 'string',
      description: 'Updated range',
      condition: { field: 'operation', value: 'write' },
    },
    updatedRows: {
      type: 'number',
      description: 'Updated rows count',
      condition: { field: 'operation', value: 'write' },
    },
    updatedColumns: {
      type: 'number',
      description: 'Updated columns count',
      condition: { field: 'operation', value: 'write' },
    },
    updatedCells: {
      type: 'number',
      description: 'Updated cells count',
      condition: { field: 'operation', value: 'write' },
    },
    cleared: {
      type: 'boolean',
      description: 'Whether the range was cleared',
      condition: { field: 'operation', value: 'clear_range' },
    },
    applyTo: {
      type: 'string',
      description: 'What was cleared (All, Contents, or Formats)',
      condition: { field: 'operation', value: 'clear_range' },
    },
    formatted: {
      type: 'boolean',
      description: 'Whether the formatting was applied',
      condition: { field: 'operation', value: 'format_range' },
    },
    fill: {
      type: 'json',
      description: 'Applied fill ({color}) or null',
      condition: { field: 'operation', value: 'format_range' },
    },
    font: {
      type: 'json',
      description: 'Applied font ({bold, italic, color, name, size}) or null',
      condition: { field: 'operation', value: 'format_range' },
    },
    table: {
      type: 'json',
      description: 'Created table ({id, name, showHeaders, showTotals, style})',
      condition: { field: 'operation', value: ['create_table', 'get_table', 'update_table'] },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the worksheet, table, or row was deleted',
      condition: {
        field: 'operation',
        value: ['delete_worksheet', 'delete_table', 'delete_table_row'],
      },
    },
    worksheetName: {
      type: 'string',
      description: 'Name of the deleted worksheet',
      condition: { field: 'operation', value: 'delete_worksheet' },
    },
    sorted: {
      type: 'boolean',
      description: 'Whether the sort was applied',
      condition: { field: 'operation', value: 'sort_range' },
    },
    target: {
      type: 'string',
      description: 'The range or table name that was sorted',
      condition: { field: 'operation', value: 'sort_range' },
    },
    metadata: { type: 'json', description: 'Spreadsheet metadata including ID and URL' },
  },
}

export const MicrosoftExcelBlockMeta = {
  tags: ['spreadsheet', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/excel',
  templates: [
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel financial close automator',
      prompt:
        'Build a scheduled workflow that closes the books each period — pulls Stripe and accounting data, updates a Microsoft Excel close workbook, and emails the controller the reconciled file.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['stripe', 'gmail'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel invoice generator',
      prompt:
        'Create a workflow that reads a sales orders table, populates an existing Microsoft Excel invoice worksheet per order, and posts the workbook link for finance review.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel report table refresher',
      prompt:
        'Build a scheduled workflow that reads rows from a source, updates a Microsoft Excel report table, and posts the workbook link to a Microsoft Teams channel.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel + SharePoint forecast hub',
      prompt:
        'Create a workflow that aggregates regional forecasts submitted in Microsoft Excel files on SharePoint, normalizes formats, and writes a consolidated forecast table for leadership.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel commission calculator',
      prompt:
        'Build a workflow that pulls closed Salesforce deals each month, computes commission per rep using a Microsoft Excel commission model, and emails the per-rep statements.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'finance'],
      alsoIntegrations: ['salesforce', 'gmail'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel scenario modeler',
      prompt:
        'Create a workflow that runs scenarios against a Microsoft Excel financial model — pessimistic, base, optimistic — captures outputs, and writes a comparison report to a finance file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel + Power BI feeder',
      prompt:
        'Build a scheduled workflow that updates a Microsoft Excel data table from a Sim source, keeps its table ready for Power BI consumption, and notifies BI consumers in Teams.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'read-sheet-range',
      description: 'Read data from a Microsoft Excel worksheet range and return the rows.',
      content:
        '# Read Sheet Range\n\nPull data out of an Excel workbook for analysis or downstream steps.\n\n## Steps\n1. Identify the workbook and the worksheet and range to read.\n2. Use Read Data with the spreadsheet ID and range.\n3. Parse the returned rows into a structured form for the next step.\n\n## Output\nThe values from the range as rows, plus the sheet and range they came from.',
    },
    {
      name: 'write-sheet-data',
      description:
        'Write or update values in a Microsoft Excel worksheet range, with values, formulas, and number formats.',
      content:
        '# Write Sheet Data\n\nUpdate cells in an Excel workbook.\n\n## Steps\n1. Identify the workbook, worksheet, and target range.\n2. Prepare the values as rows matching the range shape.\n3. Use Write/Update Data, using the Values field for cell data or the Formulas field for A1-style formulas.\n\n## Output\nConfirmation of the cells updated and the range that was written.',
    },
    {
      name: 'append-table-row',
      description:
        'Append a new row to a Microsoft Excel table so it stays structured and formatted.',
      content:
        '# Append Table Row\n\nAdd a record to an existing Excel table.\n\n## Steps\n1. Identify the workbook and the table to append to.\n2. Build the row values in the table column order.\n3. Use Add to Table to append the row so table formatting and references update automatically.\n\n## Output\nConfirmation the row was appended and the table it was added to.',
    },
    {
      name: 'add-worksheet',
      description:
        'Add a new worksheet to a Microsoft Excel workbook to hold a new dataset or report.',
      content:
        '# Add Worksheet\n\nCreate a fresh worksheet inside a workbook.\n\n## Steps\n1. Identify the workbook to add the sheet to.\n2. Choose a name for the new worksheet.\n3. Use Add Worksheet to create it, then write headers or data with Write/Update Data if needed.\n\n## Output\nThe new worksheet name and confirmation it was created in the workbook.',
    },
    {
      name: 'build-formatted-table',
      description:
        'Write data to a range, convert it into a formatted Excel table, and highlight the header row.',
      content:
        '# Build Formatted Table\n\nTurn raw rows into a structured, readable Excel table.\n\n## Steps\n1. Use Write/Update Data to put the rows into a range (e.g. A1:D20).\n2. Use Create Table over that range with headers enabled so filtering and references work.\n3. Use Format Range on the header row to apply a fill color and bold font for emphasis.\n\n## Output\nThe created table details plus confirmation the header formatting was applied.',
    },
    {
      name: 'sort-and-clean-range',
      description:
        'Sort a range or table by a column and clear stale cells so the sheet stays tidy.',
      content:
        '# Sort and Clean Range\n\nKeep a worksheet ordered and free of leftover data.\n\n## Steps\n1. Use Sort Range with the target range or table name and the column index to sort on.\n2. Choose ascending or descending order.\n3. Use Clear Range on any obsolete cells, choosing to clear contents, formats, or both.\n\n## Output\nConfirmation of the sort and which cells were cleared.',
    },
  ],
} as const satisfies BlockMeta

export const MicrosoftExcelV2BlockMeta = {
  tags: ['spreadsheet', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/excel',
} as const satisfies BlockMeta
