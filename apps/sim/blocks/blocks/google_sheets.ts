import { GoogleSheetsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleSheetsResponse } from '@/tools/google_sheets/types'

export const GoogleSheetsBlock: BlockConfig<GoogleSheetsResponse> = {
  type: 'google_sheets',
  name: 'Google Sheets',
  description: 'Read, write, and update data',
  authMode: AuthMode.OAuth,
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
        const { credential, values, spreadsheetId, manualSpreadsheetId, ...rest } = params

        const parsedValues = values ? JSON.parse(values as string) : undefined

        const effectiveSpreadsheetId = (spreadsheetId || manualSpreadsheetId || '').trim()

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
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier' },
    manualSpreadsheetId: { type: 'string', description: 'Manual spreadsheet identifier' },
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
