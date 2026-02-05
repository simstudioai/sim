import { GoogleSheetsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { GoogleSheetsResponse, GoogleSheetsV2Response } from '@/tools/google_sheets/types'

// Legacy block - hidden from toolbar
export const GoogleSheetsBlock: BlockConfig<GoogleSheetsResponse> = {
  type: 'google_sheets',
  name: 'Google Sheets (Legacy)',
  description: 'Read, write, and update data',
  authMode: AuthMode.OAuth,
  hideFromToolbar: true,
  longDescription:
    'Integrate Google Sheets into the workflow. Can read, write, append, and update data.',
  docsLink: 'https://docs.sim.ai/tools/google_sheets',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleSheetsIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write Data', id: 'write' },
        { label: 'Update Data', id: 'update' },
        { label: 'Append Data', id: 'append' },
      ],
      value: () => 'read',
    },
    // Google Sheets Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-sheets',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google account',
    },
    // Spreadsheet Selector
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'google-sheets',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.spreadsheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: ['credential'],
      mode: 'basic',
    },
    // Manual Spreadsheet ID (advanced mode)
    {
      id: 'manualSpreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      placeholder: 'ID of the spreadsheet (from URL)',
      dependsOn: ['credential'],
      mode: 'advanced',
    },
    // Range
    {
      id: 'range',
      title: 'Range',
      type: 'short-input',
      placeholder: 'Sheet name and cell range (e.g., Sheet1!A1:D10)',
      wandConfig: {
        enabled: true,
        prompt: `Generate a valid Google Sheets range based on the user's description.

### VALID FORMATS
1. Sheet name only (for appending to end): Sheet1
2. Full range (for reading/writing specific cells): Sheet1!A1:D10

### RANGE RULES
- Sheet names with spaces must be quoted: 'My Sheet'!A1:B10
- Column letters are uppercase: A, B, C, ... Z, AA, AB, etc.
- Row numbers start at 1 (not 0)
- Range format: SheetName!StartCell:EndCell (e.g., Sheet1!A2:C10)
- For a single column: Sheet1!A:A
- For a single row: Sheet1!1:1

### EXAMPLES
- "the first sheet" -> Sheet1
- "data sheet from A1 to E100" -> 'Data Sheet'!A1:E100
- "append to orders sheet" -> Orders
- "cells A1 through C50 on Sheet2" -> Sheet2!A1:C50
- "column A of inventory" -> Inventory!A:A
- "just the headers row" -> Sheet1!1:1

Return ONLY the range string - no explanations, no quotes around the entire output, no extra text.`,
        placeholder: 'Describe the range (e.g., "all data from Sheet1" or "A1 to D50")...',
      },
    },
    // Write-specific Fields
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
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

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
    // Update-specific Fields
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
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

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
    // Append-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'append' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Value1", "Value2"], ["Value3", "Value4"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Examples:
- "add new sales record" -> [["2024-01-15", "Widget Pro", 5, 249.99]]
- "append customer info" -> [{"name": "Acme Corp", "contact": "John Smith", "status": "Active"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to append...',
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
      condition: { field: 'operation', value: 'append' },
    },
    {
      id: 'insertDataOption',
      title: 'Insert Data Option',
      type: 'dropdown',
      options: [
        { label: 'Insert Rows (Add new rows)', id: 'INSERT_ROWS' },
        { label: 'Overwrite (Add to existing data)', id: 'OVERWRITE' },
      ],
      condition: { field: 'operation', value: 'append' },
    },
  ],
  tools: {
    access: [
      'google_sheets_read',
      'google_sheets_write',
      'google_sheets_update',
      'google_sheets_append',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_sheets_read'
          case 'write':
            return 'google_sheets_write'
          case 'update':
            return 'google_sheets_update'
          case 'append':
            return 'google_sheets_append'
          default:
            throw new Error(`Invalid Google Sheets operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, values, spreadsheetId, ...rest } = params

        const parsedValues = values ? JSON.parse(values as string) : undefined

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        return {
          ...rest,
          spreadsheetId: effectiveSpreadsheetId,
          values: parsedValues,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Sheets access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    range: { type: 'string', description: 'Cell range' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
    insertDataOption: { type: 'string', description: 'Data insertion option' },
  },
  outputs: {
    data: { type: 'json', description: 'Sheet data' },
    metadata: { type: 'json', description: 'Operation metadata' },
    updatedRange: { type: 'string', description: 'Updated range' },
    updatedRows: { type: 'number', description: 'Updated rows count' },
    updatedColumns: { type: 'number', description: 'Updated columns count' },
    updatedCells: { type: 'number', description: 'Updated cells count' },
    tableRange: { type: 'string', description: 'Table range' },
  },
}

export const GoogleSheetsV2Block: BlockConfig<GoogleSheetsV2Response> = {
  type: 'google_sheets_v2',
  name: 'Google Sheets',
  description: 'Read, write, and update data with sheet selection',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  longDescription:
    'Integrate Google Sheets into the workflow with explicit sheet selection. Can read, write, append, update, clear data, create spreadsheets, get spreadsheet info, and copy sheets.',
  docsLink: 'https://docs.sim.ai/tools/google_sheets',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleSheetsIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write Data', id: 'write' },
        { label: 'Update Data', id: 'update' },
        { label: 'Append Data', id: 'append' },
        { label: 'Clear Data', id: 'clear' },
        { label: 'Get Spreadsheet Info', id: 'get_info' },
        { label: 'Create Spreadsheet', id: 'create' },
        { label: 'Batch Read', id: 'batch_get' },
        { label: 'Batch Update', id: 'batch_update' },
        { label: 'Batch Clear', id: 'batch_clear' },
        { label: 'Copy Sheet', id: 'copy_sheet' },
      ],
      value: () => 'read',
    },
    // Google Sheets Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-sheets',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google account',
    },
    // Spreadsheet Selector (basic mode) - not for create operation
    {
      id: 'spreadsheetId',
      title: 'Select Spreadsheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'google-sheets',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.spreadsheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create', not: true },
    },
    // Manual Spreadsheet ID (advanced mode) - not for create operation
    {
      id: 'manualSpreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      placeholder: 'ID of the spreadsheet (from URL)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create', not: true },
    },
    // Sheet Name Selector (basic mode) - for operations that need sheet name
    {
      id: 'sheetName',
      title: 'Sheet (Tab)',
      type: 'sheet-selector',
      canonicalParamId: 'sheetName',
      serviceId: 'google-sheets',
      placeholder: 'Select a sheet',
      required: true,
      dependsOn: { all: ['credential'], any: ['spreadsheetId', 'manualSpreadsheetId'] },
      mode: 'basic',
      condition: { field: 'operation', value: ['read', 'write', 'update', 'append', 'clear'] },
    },
    // Manual Sheet Name (advanced mode) - for operations that need sheet name
    {
      id: 'manualSheetName',
      title: 'Sheet Name',
      type: 'short-input',
      canonicalParamId: 'sheetName',
      placeholder: 'Name of the sheet/tab (e.g., Sheet1)',
      required: true,
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['read', 'write', 'update', 'append', 'clear'] },
    },
    // Cell Range (optional for read/write/update/clear)
    {
      id: 'cellRange',
      title: 'Cell Range',
      type: 'short-input',
      placeholder: 'Cell range (e.g., A1:D10). Defaults to A1 for write.',
      condition: { field: 'operation', value: ['read', 'write', 'update', 'clear'] },
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
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

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
      condition: { field: 'operation', value: ['write', 'batch_update'] },
    },
    // Update-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects',
      condition: { field: 'operation', value: 'update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

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
    // Append-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects',
      condition: { field: 'operation', value: 'append' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate Google Sheets data as a JSON array based on the user's description.

Format options:
1. Array of arrays: [["Value1", "Value2"], ["Value3", "Value4"]]
2. Array of objects: [{"column1": "value1", "column2": "value2"}]

Examples:
- "add new sales record" -> [["2024-01-15", "Widget Pro", 5, 249.99]]
- "append customer info" -> [{"name": "Acme Corp", "contact": "John Smith", "status": "Active"}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the data you want to append...',
        generationType: 'json-object',
      },
    },
    {
      id: 'insertDataOption',
      title: 'Insert Data Option',
      type: 'dropdown',
      options: [
        { label: 'Insert Rows (Add new rows)', id: 'INSERT_ROWS' },
        { label: 'Overwrite (Add to existing data)', id: 'OVERWRITE' },
      ],
      condition: { field: 'operation', value: 'append' },
    },
    // Create Spreadsheet Fields
    {
      id: 'title',
      title: 'Spreadsheet Title',
      type: 'short-input',
      placeholder: 'Title for the new spreadsheet',
      condition: { field: 'operation', value: 'create' },
      required: true,
    },
    {
      id: 'sheetTitles',
      title: 'Sheet Names',
      type: 'short-input',
      placeholder: 'Comma-separated sheet names (e.g., Sheet1, Data, Summary)',
      condition: { field: 'operation', value: 'create' },
    },
    // Batch Get Fields
    {
      id: 'ranges',
      title: 'Ranges',
      type: 'long-input',
      placeholder:
        'JSON array of ranges to read (e.g., ["Sheet1!A1:D10", "Sheet2!A1:B5"]). Include sheet name in each range.',
      condition: { field: 'operation', value: 'batch_get' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Google Sheets ranges based on the user's description.

### FORMAT
Return a JSON array of range strings. Each range must include the sheet name.
Format: ["SheetName!CellRange", "SheetName!CellRange", ...]

### RANGE RULES
- Always include sheet name: Sheet1!A1:D10 (not just A1:D10)
- Sheet names with spaces must be quoted: 'My Sheet'!A1:B10
- Column letters are uppercase: A, B, C, ... Z, AA, AB
- Row numbers start at 1
- For entire column: Sheet1!A:A
- For entire row: Sheet1!1:1

### EXAMPLES
- "all data from Sales and the summary from Reports" -> ["Sales!A1:Z1000", "Reports!A1:D20"]
- "first 100 rows from Sheet1 and Sheet2" -> ["Sheet1!A1:Z100", "Sheet2!A1:Z100"]
- "headers from all three sheets" -> ["Sheet1!1:1", "Sheet2!1:1", "Sheet3!1:1"]
- "column A from Products and Orders" -> ["Products!A:A", "Orders!A:A"]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder:
          'Describe the ranges you want to read (e.g., "all data from Sales and summary from Reports")...',
        generationType: 'json-object',
      },
    },
    // Batch Update Fields
    {
      id: 'batchData',
      title: 'Data',
      type: 'long-input',
      placeholder:
        'JSON array of {range, values} objects (e.g., [{"range": "Sheet1!A1:B2", "values": [["A","B"],["C","D"]]}])',
      condition: { field: 'operation', value: 'batch_update' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of data updates for Google Sheets based on the user's description.

### FORMAT
Return a JSON array where each item has:
- "range": The target range including sheet name (e.g., "Sheet1!A1:B2")
- "values": A 2D array of values to write

Format: [{"range": "SheetName!CellRange", "values": [[row1], [row2], ...]}, ...]

### RANGE RULES
- Always include sheet name: Sheet1!A1:D10
- Sheet names with spaces must be quoted: 'My Sheet'!A1:B10
- The range size should match the values array dimensions

### EXAMPLES
- "set headers to Name, Email, Phone in Sheet1 and Status, Date in Sheet2" ->
  [{"range": "Sheet1!A1:C1", "values": [["Name", "Email", "Phone"]]}, {"range": "Sheet2!A1:B1", "values": [["Status", "Date"]]}]

- "add totals row in A10 of Sales with formula" ->
  [{"range": "Sales!A10:B10", "values": [["Total", "=SUM(B1:B9)"]]}]

- "update the first three rows of data in Products" ->
  [{"range": "Products!A2:C4", "values": [["Widget", 10, 29.99], ["Gadget", 5, 49.99], ["Tool", 20, 9.99]]}]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder:
          'Describe the updates (e.g., "set headers in Sheet1 and add totals in Sheet2")...',
        generationType: 'json-object',
      },
    },
    // Batch Clear Fields
    {
      id: 'ranges',
      title: 'Ranges to Clear',
      type: 'long-input',
      placeholder:
        'JSON array of ranges to clear (e.g., ["Sheet1!A1:D10", "Sheet2!A1:B5"]). Include sheet name in each range.',
      condition: { field: 'operation', value: 'batch_clear' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Google Sheets ranges to clear based on the user's description.

### FORMAT
Return a JSON array of range strings. Each range must include the sheet name.
Format: ["SheetName!CellRange", "SheetName!CellRange", ...]

### RANGE RULES
- Always include sheet name: Sheet1!A1:D10 (not just A1:D10)
- Sheet names with spaces must be quoted: 'My Sheet'!A1:B10
- Column letters are uppercase: A, B, C, ... Z, AA, AB
- Row numbers start at 1
- For entire column: Sheet1!A:A
- For entire row: Sheet1!1:1
- For entire sheet: Sheet1!A:ZZ (or use large range)

### EXAMPLES
- "clear all data from Sales and Reports" -> ["Sales!A1:ZZ10000", "Reports!A1:ZZ10000"]
- "clear rows 2-100 from Sheet1 and Sheet2, keep headers" -> ["Sheet1!A2:ZZ100", "Sheet2!A2:ZZ100"]
- "clear column A from Products and Orders" -> ["Products!A:A", "Orders!A:A"]
- "clear the summary section in Reports" -> ["Reports!A1:D20"]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder:
          'Describe the ranges to clear (e.g., "clear all data from Sales and Reports, keep headers")...',
        generationType: 'json-object',
      },
    },
    // Copy Sheet Fields
    {
      id: 'sheetId',
      title: 'Sheet ID',
      type: 'short-input',
      placeholder: 'Numeric ID of the sheet to copy (use Get Spreadsheet Info to find IDs)',
      condition: { field: 'operation', value: 'copy_sheet' },
      required: true,
    },
    {
      id: 'destinationSpreadsheetId',
      title: 'Destination Spreadsheet ID',
      type: 'short-input',
      placeholder: 'ID of the spreadsheet to copy to',
      condition: { field: 'operation', value: 'copy_sheet' },
      required: true,
    },
  ],
  tools: {
    access: [
      'google_sheets_read_v2',
      'google_sheets_write_v2',
      'google_sheets_update_v2',
      'google_sheets_append_v2',
      'google_sheets_clear_v2',
      'google_sheets_get_spreadsheet_v2',
      'google_sheets_create_spreadsheet_v2',
      'google_sheets_batch_get_v2',
      'google_sheets_batch_update_v2',
      'google_sheets_batch_clear_v2',
      'google_sheets_copy_sheet_v2',
    ],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => {
          switch (params.operation) {
            case 'read':
              return 'google_sheets_read'
            case 'write':
              return 'google_sheets_write'
            case 'update':
              return 'google_sheets_update'
            case 'append':
              return 'google_sheets_append'
            case 'clear':
              return 'google_sheets_clear'
            case 'get_info':
              return 'google_sheets_get_spreadsheet'
            case 'create':
              return 'google_sheets_create_spreadsheet'
            case 'batch_get':
              return 'google_sheets_batch_get'
            case 'batch_update':
              return 'google_sheets_batch_update'
            case 'batch_clear':
              return 'google_sheets_batch_clear'
            case 'copy_sheet':
              return 'google_sheets_copy_sheet'
            default:
              throw new Error(`Invalid Google Sheets operation: ${params.operation}`)
          }
        },
        suffix: '_v2',
        fallbackToolId: 'google_sheets_read_v2',
      }),
      params: (params) => {
        const {
          credential,
          values,
          spreadsheetId,
          sheetName,
          cellRange,
          title,
          sheetTitles,
          ranges,
          batchData,
          sheetId,
          destinationSpreadsheetId,
          ...rest
        } = params

        const operation = params.operation as string

        // Handle create operation
        if (operation === 'create') {
          const sheetTitlesArray = sheetTitles
            ? (sheetTitles as string).split(',').map((s: string) => s.trim())
            : undefined
          return {
            title: (title as string)?.trim(),
            sheetTitles: sheetTitlesArray,
            credential,
          }
        }

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        // Handle get_info operation
        if (operation === 'get_info') {
          return {
            spreadsheetId: effectiveSpreadsheetId,
            credential,
          }
        }

        // Handle batch_get operation
        if (operation === 'batch_get') {
          const parsedRanges = ranges ? JSON.parse(ranges as string) : []
          return {
            spreadsheetId: effectiveSpreadsheetId,
            ranges: parsedRanges,
            credential,
          }
        }

        // Handle batch_update operation
        if (operation === 'batch_update') {
          const parsedData = batchData ? JSON.parse(batchData as string) : []
          return {
            ...rest,
            spreadsheetId: effectiveSpreadsheetId,
            data: parsedData,
            credential,
          }
        }

        // Handle batch_clear operation
        if (operation === 'batch_clear') {
          const parsedRanges = ranges ? JSON.parse(ranges as string) : []
          return {
            spreadsheetId: effectiveSpreadsheetId,
            ranges: parsedRanges,
            credential,
          }
        }

        // Handle copy_sheet operation
        if (operation === 'copy_sheet') {
          return {
            sourceSpreadsheetId: effectiveSpreadsheetId,
            sheetId: Number.parseInt(sheetId as string, 10),
            destinationSpreadsheetId: (destinationSpreadsheetId as string)?.trim(),
            credential,
          }
        }

        // Handle read/write/update/append/clear operations (require sheet name)
        const effectiveSheetName = sheetName ? String(sheetName).trim() : ''

        if (!effectiveSheetName) {
          throw new Error('Sheet name is required. Please select or enter a sheet name.')
        }

        const parsedValues = values ? JSON.parse(values as string) : undefined

        return {
          ...rest,
          spreadsheetId: effectiveSpreadsheetId,
          sheetName: effectiveSheetName,
          cellRange: cellRange ? (cellRange as string).trim() : undefined,
          values: parsedValues,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Sheets access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    sheetName: { type: 'string', description: 'Name of the sheet/tab (canonical param)' },
    cellRange: { type: 'string', description: 'Cell range (e.g., A1:D10)' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
    insertDataOption: { type: 'string', description: 'Data insertion option' },
    title: { type: 'string', description: 'Title for new spreadsheet' },
    sheetTitles: { type: 'string', description: 'Comma-separated sheet names for new spreadsheet' },
    ranges: { type: 'string', description: 'JSON array of ranges for batch operations' },
    batchData: { type: 'string', description: 'JSON array of data for batch update' },
    sheetId: { type: 'string', description: 'Numeric sheet ID for copy operation' },
    destinationSpreadsheetId: {
      type: 'string',
      description: 'Destination spreadsheet ID for copy',
    },
  },
  outputs: {
    // Read outputs
    sheetName: {
      type: 'string',
      description: 'Name of the sheet',
      condition: { field: 'operation', value: ['read', 'clear'] },
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
    // Write/Update/Append outputs
    updatedRange: {
      type: 'string',
      description: 'Updated range',
      condition: { field: 'operation', value: ['write', 'update', 'append'] },
    },
    updatedRows: {
      type: 'number',
      description: 'Updated rows count',
      condition: { field: 'operation', value: ['write', 'update', 'append'] },
    },
    updatedColumns: {
      type: 'number',
      description: 'Updated columns count',
      condition: { field: 'operation', value: ['write', 'update', 'append'] },
    },
    updatedCells: {
      type: 'number',
      description: 'Updated cells count',
      condition: { field: 'operation', value: ['write', 'update', 'append'] },
    },
    tableRange: {
      type: 'string',
      description: 'Table range',
      condition: { field: 'operation', value: 'append' },
    },
    // Clear outputs
    clearedRange: {
      type: 'string',
      description: 'Range that was cleared',
      condition: { field: 'operation', value: 'clear' },
    },
    // Get Info / Create / Batch outputs
    spreadsheetId: {
      type: 'string',
      description: 'Spreadsheet ID',
      condition: {
        field: 'operation',
        value: ['get_info', 'create', 'batch_get', 'batch_update', 'batch_clear'],
      },
    },
    title: {
      type: 'string',
      description: 'Spreadsheet title (or copied sheet title for copy_sheet)',
      condition: { field: 'operation', value: ['get_info', 'create', 'copy_sheet'] },
    },
    sheets: {
      type: 'json',
      description: 'List of sheets in the spreadsheet',
      condition: { field: 'operation', value: ['get_info', 'create'] },
    },
    locale: {
      type: 'string',
      description: 'Spreadsheet locale',
      condition: { field: 'operation', value: 'get_info' },
    },
    timeZone: {
      type: 'string',
      description: 'Spreadsheet time zone',
      condition: { field: 'operation', value: 'get_info' },
    },
    spreadsheetUrl: {
      type: 'string',
      description: 'Spreadsheet URL',
      condition: { field: 'operation', value: ['get_info', 'create'] },
    },
    // Batch Get outputs
    valueRanges: {
      type: 'json',
      description: 'Array of value ranges read from the spreadsheet',
      condition: { field: 'operation', value: 'batch_get' },
    },
    // Batch Update outputs
    totalUpdatedRows: {
      type: 'number',
      description: 'Total rows updated',
      condition: { field: 'operation', value: 'batch_update' },
    },
    totalUpdatedColumns: {
      type: 'number',
      description: 'Total columns updated',
      condition: { field: 'operation', value: 'batch_update' },
    },
    totalUpdatedCells: {
      type: 'number',
      description: 'Total cells updated',
      condition: { field: 'operation', value: 'batch_update' },
    },
    totalUpdatedSheets: {
      type: 'number',
      description: 'Total sheets updated',
      condition: { field: 'operation', value: 'batch_update' },
    },
    responses: {
      type: 'json',
      description: 'Array of update responses for each range',
      condition: { field: 'operation', value: 'batch_update' },
    },
    // Batch Clear outputs
    clearedRanges: {
      type: 'json',
      description: 'Array of ranges that were cleared',
      condition: { field: 'operation', value: 'batch_clear' },
    },
    // Copy Sheet outputs
    sheetId: {
      type: 'number',
      description: 'ID of the copied sheet in the destination',
      condition: { field: 'operation', value: 'copy_sheet' },
    },
    index: {
      type: 'number',
      description: 'Position/index of the copied sheet',
      condition: { field: 'operation', value: 'copy_sheet' },
    },
    sheetType: {
      type: 'string',
      description: 'Type of the sheet (GRID, CHART, etc.)',
      condition: { field: 'operation', value: 'copy_sheet' },
    },
    destinationSpreadsheetId: {
      type: 'string',
      description: 'ID of the destination spreadsheet',
      condition: { field: 'operation', value: 'copy_sheet' },
    },
    destinationSpreadsheetUrl: {
      type: 'string',
      description: 'URL of the destination spreadsheet',
      condition: { field: 'operation', value: 'copy_sheet' },
    },
    // Common metadata
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID and URL',
      condition: {
        field: 'operation',
        value: [
          'read',
          'write',
          'update',
          'append',
          'clear',
          'batch_get',
          'batch_update',
          'batch_clear',
        ],
      },
    },
  },
}
