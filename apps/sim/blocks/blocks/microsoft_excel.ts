import { MicrosoftExcelIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type {
  MicrosoftExcelResponse,
  MicrosoftExcelV2Response,
} from '@/tools/microsoft_excel/types'

/** Maps the read/write operation to its `_v2` tool id, falling back to read on unknown ops. */
const versionedReadWriteSelector = createVersionedToolSelector<Record<string, any>>({
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
  return Number.isNaN(num) ? undefined : num
}

/** Wraps a worksheet name in single quotes when it contains characters that require escaping in an address. */
function quoteSheetName(sheetName: string): string {
  if (/^[A-Za-z0-9_]+$/.test(sheetName)) return sheetName
  return `'${sheetName.replace(/'/g, "''")}'`
}

export const MicrosoftExcelBlock: BlockConfig<MicrosoftExcelResponse> = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel (Legacy)',
  description: 'Read, write, and update data',
  authMode: AuthMode.OAuth,
  hideFromToolbar: true,
  longDescription:
    'Integrate Microsoft Excel into the workflow. Can read, write, update, add to table, and create new worksheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
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
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: ['credential'],
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
      required: {
        field: 'operation',
        value: ['clear_range', 'format_range', 'create_table'],
      },
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
      required: true,
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'write' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Header1", "Header2"], ["Value1", "Value2"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Examples:
- "sales data with product and revenue columns" -> [["Product", "Revenue"], ["Widget A", 1500], ["Widget B", 2300]]
- "list of employees with name and email" -> [{"name": "John Doe", "email": "john@example.com"}, {"name": "Jane Smith", "email": "jane@example.com"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to write...',
        generationType: 'json-object',
      },
    },
    {
      id: 'valueInputOption',
      title: 'Value Input Option',
      type: 'dropdown',
      options: [
        { label: 'User Entered (Parse formulas)', id: 'USER_ENTERED' },
        { label: "Raw (Don't parse formulas)", id: 'RAW' },
      ],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Header1", "Header2"], ["Value1", "Value2"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Examples:
- "update with new prices" -> [["Product", "Price"], ["Widget A", 29.99], ["Widget B", 49.99]]
- "quarterly targets" -> [{"Q1": 10000, "Q2": 12000, "Q3": 15000, "Q4": 18000}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to update...',
        generationType: 'json-object',
      },
    },
    {
      id: 'valueInputOption',
      title: 'Value Input Option',
      type: 'dropdown',
      options: [
        { label: 'User Entered (Parse formulas)', id: 'USER_ENTERED' },
        { label: "Raw (Don't parse formulas)", id: 'RAW' },
      ],
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'table_add' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel table row data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Value1", "Value2"], ["Value3", "Value4"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Note: When adding to an existing table, do NOT include headers - only data rows.

Examples:
- "add new sales record" -> [["2024-01-15", "Widget Pro", 5, 249.99]]
- "append customer info" -> [{"name": "Acme Corp", "contact": "John Smith", "status": "Active"}]
- "add multiple rows with name, age, city" -> [["Alice", 28, "NYC"], ["Bob", 35, "LA"]]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to add to the table...',
        generationType: 'json-object',
      },
    },
    // Clear Range
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
    // Format Range
    {
      id: 'fillColor',
      title: 'Fill Color',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FFFF00)',
      condition: { field: 'operation', value: 'format_range' },
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
    // Create Table
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
    // Sort Range
    {
      id: 'sortTableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'Optional: sort a table instead of the cell range',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'sortColumn',
      title: 'Sort Column Index',
      type: 'short-input',
      placeholder: 'Zero-based column index (0 = first column)',
      condition: { field: 'operation', value: 'sort_range' },
      required: { field: 'operation', value: 'sort_range' },
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
          valueInputOption,
        } = params

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''
        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        const effectiveDriveId = driveId ? String(driveId).trim() : undefined
        const trimmedRange = range ? String(range).trim() : undefined

        const base = {
          spreadsheetId: effectiveSpreadsheetId,
          driveId: effectiveDriveId,
          oauthCredential,
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
            }
          case 'create_table': {
            if (!trimmedRange) {
              throw new Error('A range is required to create a table.')
            }
            return {
              ...base,
              address: trimmedRange,
              hasHeaders: optionalBoolean(tableHasHeaders) ?? true,
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
            const effectiveTableName = optionalString(sortTableName)
            if (!effectiveTableName && !trimmedRange) {
              throw new Error('A range or table name is required to sort.')
            }
            return {
              ...base,
              range: trimmedRange,
              tableName: effectiveTableName,
              sortColumn: optionalNumber(sortColumn),
              sortAscending: optionalBoolean(sortAscending) ?? true,
              hasHeaders: optionalBoolean(sortHasHeaders),
              matchCase: optionalBoolean(sortMatchCase),
            }
          }
          default: {
            let parsedValues
            try {
              parsedValues = values ? JSON.parse(values as string) : undefined
            } catch {
              throw new Error('Invalid JSON format for values')
            }

            if (operation === 'table_add' && !tableName) {
              throw new Error('Table name is required for table operations.')
            }
            if (operation === 'worksheet_add' && !worksheetName) {
              throw new Error('Worksheet name is required for worksheet operations.')
            }

            const baseParams = {
              ...base,
              range: trimmedRange,
              values: parsedValues,
              valueInputOption,
            }

            if (operation === 'table_add') {
              return { ...baseParams, tableName }
            }
            if (operation === 'worksheet_add') {
              return { ...baseParams, worksheetName }
            }
            return baseParams
          }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Microsoft Excel access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    driveId: { type: 'string', description: 'Drive ID for SharePoint document libraries' },
    range: { type: 'string', description: 'Cell range' },
    tableName: { type: 'string', description: 'Table name' },
    worksheetName: { type: 'string', description: 'Worksheet name' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
    applyTo: { type: 'string', description: 'What to clear (All, Contents, Formats)' },
    fillColor: { type: 'string', description: 'Background fill color' },
    fontBold: { type: 'string', description: 'Bold font toggle' },
    fontItalic: { type: 'string', description: 'Italic font toggle' },
    fontColor: { type: 'string', description: 'Font color' },
    fontSize: { type: 'string', description: 'Font size in points' },
    fontName: { type: 'string', description: 'Font name' },
    tableHasHeaders: { type: 'string', description: 'Whether the table range has a header row' },
    sortTableName: { type: 'string', description: 'Table name to sort (optional)' },
    sortColumn: { type: 'string', description: 'Zero-based column index to sort on' },
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
    values: { type: 'json', description: 'Cell values array for table add operations' },
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

export const MicrosoftExcelV2Block: BlockConfig<MicrosoftExcelV2Response> = {
  type: 'microsoft_excel_v2',
  name: 'Microsoft Excel',
  description: 'Read and write data with sheet selection',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  longDescription:
    'Integrate Microsoft Excel into the workflow with explicit sheet selection. Can read and write data in specific sheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  subBlocks: [
    // Operation selector
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
      ],
      value: () => 'read',
    },
    // Microsoft Excel Credentials
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
    // File Source selector (both modes)
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
    // SharePoint Site Selector (basic mode, only when SharePoint is selected)
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
    // SharePoint Drive Selector (basic mode, only when SharePoint is selected)
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
    // Spreadsheet Selector (basic mode)
    {
      id: 'spreadsheetId',
      title: 'Select Spreadsheet',
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
    // Drive ID for SharePoint (advanced mode, only when SharePoint is selected)
    {
      id: 'manualDriveId',
      title: 'Drive ID',
      type: 'short-input',
      canonicalParamId: 'driveId',
      placeholder: 'Enter the SharePoint drive ID',
      condition: { field: 'fileSource', value: 'sharepoint' },
      dependsOn: ['fileSource'],
      mode: 'advanced',
    },
    // Manual Spreadsheet ID (advanced mode)
    {
      id: 'manualSpreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      placeholder: 'Enter spreadsheet ID',
      dependsOn: { all: ['credential'], any: ['credential', 'manualDriveId'] },
      mode: 'advanced',
    },
    // Sheet Name Selector (basic mode)
    {
      id: 'sheetName',
      title: 'Sheet (Tab)',
      type: 'sheet-selector',
      canonicalParamId: 'sheetName',
      serviceId: 'microsoft-excel',
      selectorKey: 'microsoft.excel.sheets',
      placeholder: 'Select a sheet',
      required: true,
      dependsOn: {
        all: ['credential'],
        any: ['spreadsheetId', 'manualSpreadsheetId', 'driveSelector'],
      },
      mode: 'basic',
    },
    // Manual Sheet Name (advanced mode)
    {
      id: 'manualSheetName',
      title: 'Sheet Name',
      type: 'short-input',
      canonicalParamId: 'sheetName',
      placeholder: 'Name of the sheet/tab (e.g., Sheet1)',
      required: true,
      dependsOn: {
        all: ['credential'],
        any: ['credential', 'manualDriveId'],
      },
      mode: 'advanced',
    },
    // Cell Range (used by read/write/clear/format/create_table/sort)
    {
      id: 'cellRange',
      title: 'Cell Range',
      type: 'short-input',
      placeholder: 'Cell range (e.g., A1:D10). Defaults to used range for read, A1 for write.',
      condition: { field: 'operation', value: 'delete_worksheet', not: true },
      required: {
        field: 'operation',
        value: ['clear_range', 'format_range', 'create_table'],
      },
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
    // Write-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}])',
      condition: { field: 'operation', value: 'write' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Microsoft Excel data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Header1", "Header2"], ["Value1", "Value2"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Examples:
- "sales data with product and revenue columns" -> [["Product", "Revenue"], ["Widget A", 1500], ["Widget B", 2300]]
- "list of employees with name and email" -> [{"name": "John Doe", "email": "john@example.com"}, {"name": "Jane Smith", "email": "jane@example.com"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to write...',
        generationType: 'json-object',
      },
    },
    {
      id: 'valueInputOption',
      title: 'Value Input Option',
      type: 'dropdown',
      options: [
        { label: 'User Entered (Parse formulas)', id: 'USER_ENTERED' },
        { label: "Raw (Don't parse formulas)", id: 'RAW' },
      ],
      condition: { field: 'operation', value: 'write' },
    },
    // Clear Range
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
    // Format Range
    {
      id: 'fillColor',
      title: 'Fill Color',
      type: 'short-input',
      placeholder: 'Hex color (e.g., #FFFF00)',
      condition: { field: 'operation', value: 'format_range' },
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
    // Create Table
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
    // Sort Range
    {
      id: 'sortTableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'Optional: sort a table instead of the cell range',
      condition: { field: 'operation', value: 'sort_range' },
      mode: 'advanced',
    },
    {
      id: 'sortColumn',
      title: 'Sort Column Index',
      type: 'short-input',
      placeholder: 'Zero-based column index (0 = first column)',
      condition: { field: 'operation', value: 'sort_range' },
      required: { field: 'operation', value: 'sort_range' },
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
  ],
  tools: {
    access: [
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
          valueInputOption,
        } = params

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''
        const effectiveSheetName = sheetName ? String(sheetName).trim() : ''
        const effectiveDriveId = driveId ? String(driveId).trim() : undefined
        const trimmedRange = cellRange ? String(cellRange).trim() : undefined

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        const base = {
          spreadsheetId: effectiveSpreadsheetId,
          driveId: effectiveDriveId,
          oauthCredential,
        }

        switch (operation) {
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
            }
          case 'create_table': {
            if (!effectiveSheetName) {
              throw new Error('Sheet name is required to create a table.')
            }
            if (!trimmedRange) {
              throw new Error('A cell range is required to create a table.')
            }
            return {
              ...base,
              address: `${quoteSheetName(effectiveSheetName)}!${trimmedRange}`,
              hasHeaders: optionalBoolean(tableHasHeaders) ?? true,
            }
          }
          case 'delete_worksheet':
            if (!effectiveSheetName) {
              throw new Error('Sheet name is required to delete a worksheet.')
            }
            return {
              ...base,
              worksheetName: effectiveSheetName,
            }
          case 'sort_range': {
            const tableName = optionalString(sortTableName)
            if (!tableName && !trimmedRange) {
              throw new Error('A cell range or table name is required to sort.')
            }
            return {
              ...base,
              sheetName: effectiveSheetName || undefined,
              range: trimmedRange,
              tableName,
              sortColumn: optionalNumber(sortColumn),
              sortAscending: optionalBoolean(sortAscending) ?? true,
              hasHeaders: optionalBoolean(sortHasHeaders),
              matchCase: optionalBoolean(sortMatchCase),
            }
          }
          default: {
            if (!effectiveSheetName) {
              throw new Error('Sheet name is required. Please select or enter a sheet name.')
            }
            const parsedValues = values ? JSON.parse(values as string) : undefined
            return {
              ...base,
              sheetName: effectiveSheetName,
              cellRange: trimmedRange,
              values: parsedValues,
              valueInputOption,
            }
          }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    fileSource: { type: 'string', description: 'File source (onedrive or sharepoint)' },
    oauthCredential: { type: 'string', description: 'Microsoft Excel access token' },
    siteId: { type: 'string', description: 'SharePoint site ID (used for drive/file browsing)' },
    driveId: { type: 'string', description: 'Drive ID for SharePoint document libraries' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    sheetName: { type: 'string', description: 'Name of the sheet/tab (canonical param)' },
    cellRange: { type: 'string', description: 'Cell range (e.g., A1:D10)' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
    applyTo: { type: 'string', description: 'What to clear (All, Contents, Formats)' },
    fillColor: { type: 'string', description: 'Background fill color' },
    fontBold: { type: 'string', description: 'Bold font toggle' },
    fontItalic: { type: 'string', description: 'Italic font toggle' },
    fontColor: { type: 'string', description: 'Font color' },
    fontSize: { type: 'string', description: 'Font size in points' },
    fontName: { type: 'string', description: 'Font name' },
    tableHasHeaders: { type: 'string', description: 'Whether the table range has a header row' },
    sortTableName: { type: 'string', description: 'Table name to sort (optional)' },
    sortColumn: { type: 'string', description: 'Zero-based column index to sort on' },
    sortAscending: { type: 'string', description: 'Sort order (ascending/descending)' },
    sortHasHeaders: { type: 'string', description: 'Whether the range has a header row' },
    sortMatchCase: { type: 'string', description: 'Whether casing affects ordering' },
  },
  outputs: {
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
      description: 'Cell values as 2D array',
      condition: { field: 'operation', value: 'read' },
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
      condition: { field: 'operation', value: 'create_table' },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the worksheet was deleted',
      condition: { field: 'operation', value: 'delete_worksheet' },
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
        'Create a workflow that reads a sales orders table, populates a Microsoft Excel invoice template per order, and saves the file to a SharePoint folder for finance review.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel pivot refresher',
      prompt:
        'Build a scheduled workflow that refreshes a Microsoft Excel pivot table from a SQL source, exports the rendered snapshot, and posts the file link to a Microsoft Teams channel.',
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
        'Build a scheduled workflow that updates a Microsoft Excel data table from a Sim source, refreshes the dependent Power BI dataset, and notifies BI consumers in Teams.',
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
        'Write or update values in a Microsoft Excel worksheet range, with formula parsing control.',
      content:
        '# Write Sheet Data\n\nUpdate cells in an Excel workbook.\n\n## Steps\n1. Identify the workbook, worksheet, and target range.\n2. Prepare the values as rows matching the range shape.\n3. Use Write/Update Data, choosing User Entered to parse formulas or Raw to write values literally.\n\n## Output\nConfirmation of the cells updated and the range that was written.',
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
