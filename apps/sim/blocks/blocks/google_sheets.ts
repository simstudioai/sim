import { GoogleSheetsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import {
  GoogleSheetsBlockDisplay,
  GoogleSheetsV2BlockDisplay,
} from '@/blocks/blocks/google_sheets.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector, SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleSheetsResponse, GoogleSheetsV2Response } from '@/tools/google_sheets/types'
import { getTrigger } from '@/triggers'

// Legacy block - hidden from toolbar
export const GoogleSheetsBlock: BlockConfig<GoogleSheetsResponse> = {
  ...GoogleSheetsBlockDisplay,
  authMode: AuthMode.OAuth,
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-sheets',
      requiredScopes: getScopesForService('google-sheets'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Spreadsheet Selector
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'google-sheets',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-sheets'),
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
        const { oauthCredential, values, spreadsheetId, ...rest } = params

        const parsedValues = values ? JSON.parse(values as string) : undefined

        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        return {
          ...rest,
          spreadsheetId: effectiveSpreadsheetId,
          values: parsedValues,
          oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Sheets access token' },
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
  ...GoogleSheetsV2BlockDisplay,
  authMode: AuthMode.OAuth,
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
        { label: 'Delete Rows', id: 'delete_rows' },
        { label: 'Delete Sheet', id: 'delete_sheet' },
        { label: 'Delete Spreadsheet', id: 'delete_spreadsheet' },
      ],
      value: () => 'read',
    },
    // Google Sheets Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-sheets',
      requiredScopes: getScopesForService('google-sheets'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Spreadsheet Selector (basic mode) - not for create operation
    {
      id: 'spreadsheetId',
      title: 'Select Spreadsheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'google-sheets',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-sheets'),
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
      selectorKey: 'google.sheets',
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
      dependsOn: { all: ['credential'], any: ['spreadsheetId', 'manualSpreadsheetId'] },
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
    // Read Filter Fields (advanced mode only)
    {
      id: 'filterColumn',
      title: 'Filter Column',
      type: 'short-input',
      placeholder: 'Column header name to filter on (e.g., Email, Status)',
      condition: { field: 'operation', value: 'read' },
      mode: 'advanced',
    },
    {
      id: 'filterValue',
      title: 'Filter Value',
      type: 'short-input',
      placeholder: 'Value to match against',
      condition: { field: 'operation', value: 'read' },
      mode: 'advanced',
    },
    {
      id: 'filterMatchType',
      title: 'Match Type',
      type: 'dropdown',
      options: [
        { label: 'Contains', id: 'contains' },
        { label: 'Does Not Contain', id: 'not_contains' },
        { label: 'Exact Match', id: 'exact' },
        { label: 'Not Equal To', id: 'not_equals' },
        { label: 'Starts With', id: 'starts_with' },
        { label: 'Ends With', id: 'ends_with' },
        { label: 'Greater Than', id: 'gt' },
        { label: 'Greater Than or Equal', id: 'gte' },
        { label: 'Less Than', id: 'lt' },
        { label: 'Less Than or Equal', id: 'lte' },
      ],
      condition: { field: 'operation', value: 'read' },
      mode: 'advanced',
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
      condition: { field: 'operation', value: ['write', 'update', 'batch_update'] },
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
    // Delete Rows / Delete Sheet Fields
    {
      id: 'deleteSheetId',
      title: 'Sheet ID',
      type: 'short-input',
      placeholder: 'Numeric ID of the sheet/tab (use Get Spreadsheet Info to find IDs)',
      condition: { field: 'operation', value: ['delete_rows', 'delete_sheet'] },
      required: true,
    },
    // Delete Rows Fields
    {
      id: 'startIndex',
      title: 'Start Row Index',
      type: 'short-input',
      placeholder: '0-based, inclusive (e.g., 0 for the first row)',
      condition: { field: 'operation', value: 'delete_rows' },
      required: true,
    },
    {
      id: 'endIndex',
      title: 'End Row Index',
      type: 'short-input',
      placeholder: '0-based, exclusive (e.g., 5 to delete through the fifth row)',
      condition: { field: 'operation', value: 'delete_rows' },
      required: true,
    },
    ...getTrigger('google_sheets_poller').subBlocks,
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
      'google_sheets_delete_rows_v2',
      'google_sheets_delete_sheet_v2',
      'google_sheets_delete_spreadsheet_v2',
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
            case 'delete_rows':
              return 'google_sheets_delete_rows'
            case 'delete_sheet':
              return 'google_sheets_delete_sheet'
            case 'delete_spreadsheet':
              return 'google_sheets_delete_spreadsheet'
            default:
              throw new Error(`Invalid Google Sheets operation: ${params.operation}`)
          }
        },
        suffix: '_v2',
        fallbackToolId: 'google_sheets_read_v2',
      }),
      params: (params) => {
        const {
          oauthCredential,
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
          deleteSheetId,
          startIndex,
          endIndex,
          filterColumn,
          filterValue,
          filterMatchType,
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
            oauthCredential,
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
            oauthCredential,
          }
        }

        // Handle batch_get operation
        if (operation === 'batch_get') {
          const parsedRanges = ranges ? JSON.parse(ranges as string) : []
          return {
            spreadsheetId: effectiveSpreadsheetId,
            ranges: parsedRanges,
            oauthCredential,
          }
        }

        // Handle batch_update operation
        if (operation === 'batch_update') {
          const parsedData = batchData ? JSON.parse(batchData as string) : []
          return {
            ...rest,
            spreadsheetId: effectiveSpreadsheetId,
            data: parsedData,
            oauthCredential,
          }
        }

        // Handle batch_clear operation
        if (operation === 'batch_clear') {
          const parsedRanges = ranges ? JSON.parse(ranges as string) : []
          return {
            spreadsheetId: effectiveSpreadsheetId,
            ranges: parsedRanges,
            oauthCredential,
          }
        }

        // Handle copy_sheet operation
        if (operation === 'copy_sheet') {
          return {
            sourceSpreadsheetId: effectiveSpreadsheetId,
            sheetId: Number.parseInt(sheetId as string, 10),
            destinationSpreadsheetId: (destinationSpreadsheetId as string)?.trim(),
            oauthCredential,
          }
        }

        // Handle delete_spreadsheet operation
        if (operation === 'delete_spreadsheet') {
          return {
            spreadsheetId: effectiveSpreadsheetId,
            oauthCredential,
          }
        }

        // Handle delete_sheet operation
        if (operation === 'delete_sheet') {
          const parsedSheetId = Number.parseInt(deleteSheetId as string, 10)
          if (Number.isNaN(parsedSheetId)) {
            throw new Error('Sheet ID must be a valid number')
          }
          return {
            spreadsheetId: effectiveSpreadsheetId,
            sheetId: parsedSheetId,
            oauthCredential,
          }
        }

        // Handle delete_rows operation
        if (operation === 'delete_rows') {
          const parsedSheetId = Number.parseInt(deleteSheetId as string, 10)
          const parsedStartIndex = Number.parseInt(startIndex as string, 10)
          const parsedEndIndex = Number.parseInt(endIndex as string, 10)
          if (
            Number.isNaN(parsedSheetId) ||
            Number.isNaN(parsedStartIndex) ||
            Number.isNaN(parsedEndIndex)
          ) {
            throw new Error('Sheet ID, start index, and end index must be valid numbers')
          }
          return {
            spreadsheetId: effectiveSpreadsheetId,
            sheetId: parsedSheetId,
            startIndex: parsedStartIndex,
            endIndex: parsedEndIndex,
            oauthCredential,
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
          oauthCredential,
          ...(filterColumn ? { filterColumn: (filterColumn as string).trim() } : {}),
          ...(filterValue !== undefined && filterValue !== ''
            ? { filterValue: filterValue as string }
            : {}),
          ...(filterMatchType ? { filterMatchType: filterMatchType as string } : {}),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Sheets access token' },
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
    deleteSheetId: {
      type: 'string',
      description: 'Numeric sheet ID for delete rows/sheet operations',
    },
    startIndex: {
      type: 'string',
      description: 'Start row index (0-based, inclusive) for delete rows operation',
    },
    endIndex: {
      type: 'string',
      description: 'End row index (0-based, exclusive) for delete rows operation',
    },
    filterColumn: {
      type: 'string',
      description: 'Column header name to filter the read rows on (within the read range)',
    },
    filterValue: { type: 'string', description: 'Value to match against the filter column' },
    filterMatchType: {
      type: 'string',
      description:
        'Match type: contains, not_contains, exact, not_equals, starts_with, ends_with, gt, gte, lt, or lte',
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
    filter: {
      type: 'json',
      description:
        'Filter summary (present only when a filter was requested): applied, column, matchType, columnFound, matchedRows, totalRows',
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
        value: [
          'get_info',
          'create',
          'batch_get',
          'batch_update',
          'batch_clear',
          'delete_rows',
          'delete_sheet',
          'delete_spreadsheet',
        ],
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
    // Copy Sheet / Delete Rows outputs
    sheetId: {
      type: 'number',
      description:
        'ID of the copied sheet in the destination, or the sheet the rows were deleted from',
      condition: { field: 'operation', value: ['copy_sheet', 'delete_rows'] },
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
    // Delete Rows outputs
    deletedRowRange: {
      type: 'string',
      description: 'Description of the deleted row range',
      condition: { field: 'operation', value: 'delete_rows' },
    },
    // Delete Sheet outputs
    deletedSheetId: {
      type: 'number',
      description: 'The numeric ID of the deleted sheet',
      condition: { field: 'operation', value: 'delete_sheet' },
    },
    // Delete Spreadsheet outputs
    deleted: {
      type: 'boolean',
      description: 'Whether the spreadsheet was successfully deleted',
      condition: { field: 'operation', value: 'delete_spreadsheet' },
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
          'delete_rows',
          'delete_sheet',
        ],
      },
    },
  },
  triggers: {
    enabled: true,
    available: ['google_sheets_poller'],
  },
}

export const GoogleSheetsBlockMeta = {
  tags: ['spreadsheet', 'google-workspace', 'data-analytics'],
  url: 'https://workspace.google.com/products/sheets',
  templates: [
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets approval gate',
      prompt:
        'Build a workflow that watches a Google Sheets row for a status change to "review", posts the row context to Slack with approval buttons, and writes the decision back.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets to Stripe payouts',
      prompt:
        'Create a workflow that reads a Google Sheets payouts ledger, validates each row, processes Stripe payouts in batches, and writes the result and Stripe ID back.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['stripe'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets CRM updater',
      prompt:
        'Build a scheduled workflow that pulls Salesforce opportunities, refreshes the Google Sheets spreadsheet that ops uses for weekly forecasting, and notes the last-updated timestamp.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets data validator',
      prompt:
        'Create a scheduled workflow that validates a Google Sheets spreadsheet against a typed schema, flags rows with errors, writes a remediation column, and emails the sheet owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets inventory sync',
      prompt:
        'Build a workflow that pulls Shopify inventory into Google Sheets hourly, calculates days-of-cover, and highlights items needing reorder for the ops team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'sync'],
      alsoIntegrations: ['shopify'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Google Sheets forms cleanup',
      prompt:
        'Create a workflow that normalizes Google Sheets data submitted from Google Forms — title casing, phone formats, deduplication — and writes clean rows to a downstream sheet.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
      alsoIntegrations: ['google_forms'],
    },

    {
      icon: GoogleSheetsIcon,
      title: 'Send Slack messages from Google Sheets',
      prompt:
        'Build a workflow that watches a Google Sheets spreadsheet for new rows or changes, then posts formatted Slack updates to keep stakeholders informed in real time.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleSheetsIcon,
      title: 'Sync Google Sheets data into Notion',
      prompt:
        'Create an agent that reads rows from Google Sheets and transforms them into structured Notion database entries for richer documentation and cross-team project tracking.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'read-sheet-data',
      description: 'Read rows from a Google Sheet, optionally filtering by a column value.',
      content:
        '# Read Sheet Data\n\nPull data out of a spreadsheet tab.\n\n## Steps\n1. Select the spreadsheet and the Sheet (tab) to read.\n2. Optionally set a Cell Range (e.g., A1:D100); leave blank to read the used range.\n3. To narrow rows, set Filter Column (a header name), Filter Value, and Match Type (contains, exact, gt, etc.).\n4. Run the Read Data operation and treat the first row as headers if present.\n\n## Output\nReturn the rows (as a 2D array or labeled objects keyed by header), the range read, and a filter summary if a filter was applied. Note the row count.',
    },
    {
      name: 'append-rows-to-sheet',
      description: 'Add new rows to the end of a Google Sheet without overwriting existing data.',
      content:
        '# Append Rows to a Sheet\n\nAdd records to the bottom of a tab.\n\n## Steps\n1. Select the spreadsheet and Sheet (tab).\n2. Build the Values as a JSON array of arrays (each inner array is a row) or array of objects keyed by column.\n3. Set Insert Data Option to Insert Rows so existing data is not overwritten.\n4. Choose Value Input Option: User Entered (parses formulas/dates) or Raw.\n5. Run the Append Data operation.\n\n## Output\nConfirm the append: updated range, rows added, and the table range. Ensure column order matches the sheet headers.',
    },
    {
      name: 'update-cells',
      description: 'Write or update values in a specific range of a Google Sheet.',
      content:
        '# Update Cells\n\nWrite values into a targeted range.\n\n## Steps\n1. Select the spreadsheet and Sheet (tab) and set the Cell Range to write (e.g., B2:D2).\n2. Build the Values JSON so its dimensions match the range.\n3. Pick Value Input Option: User Entered to evaluate formulas, or Raw to store literal text.\n4. Run the Update Data operation (use Write Data to set a fresh block).\n\n## Output\nConfirm updated range and the count of updated cells/rows/columns. If writing formulas, confirm User Entered was used so they evaluate.',
    },
    {
      name: 'create-spreadsheet',
      description: 'Create a new Google Sheets spreadsheet with named tabs and return its link.',
      content:
        '# Create a Spreadsheet\n\nStand up a new spreadsheet.\n\n## Steps\n1. Set the Spreadsheet Title.\n2. Optionally provide Sheet Names as a comma-separated list (e.g., "Data, Summary").\n3. Run the Create Spreadsheet operation and capture the spreadsheet ID and URL.\n4. Follow up with Write or Append operations to populate the tabs.\n\n## Output\nReturn the new spreadsheet title, ID, URL, and the list of sheets created. Hand back the ID so subsequent steps can write to it.',
    },
  ],
} as const satisfies BlockMeta

export const GoogleSheetsV2BlockMeta = {
  tags: ['spreadsheet', 'google-workspace', 'data-analytics'],
  url: 'https://workspace.google.com/products/sheets',
} as const satisfies BlockMeta
