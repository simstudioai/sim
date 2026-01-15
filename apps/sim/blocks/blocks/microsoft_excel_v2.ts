import { MicrosoftExcelIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { MicrosoftExcelV2Response } from '@/tools/microsoft_excel/types'

export const MicrosoftExcelV2Block: BlockConfig<MicrosoftExcelV2Response> = {
  type: 'microsoft_excel_v2',
  name: 'Microsoft Excel',
  description: 'Read and write data with sheet selection',
  authMode: AuthMode.OAuth,
  hideFromToolbar: false,
  longDescription:
    'Integrate Microsoft Excel into the workflow with explicit sheet selection. Can read and write data in specific sheets.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_excel',
  category: 'tools',
  bgColor: '#E0E0E0',
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
      ],
      value: () => 'read',
    },
    // Microsoft Excel Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'microsoft-excel',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
      required: true,
    },
    // Spreadsheet Selector (basic mode)
    {
      id: 'spreadsheetId',
      title: 'Select Spreadsheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'microsoft-excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      placeholder: 'Enter spreadsheet ID',
      dependsOn: ['credential'],
      mode: 'advanced',
    },
    // Sheet Name Selector (basic mode)
    {
      id: 'sheetName',
      title: 'Sheet (Tab)',
      type: 'sheet-selector',
      canonicalParamId: 'sheetName',
      serviceId: 'microsoft-excel',
      placeholder: 'Select a sheet',
      required: true,
      dependsOn: { all: ['credential'], any: ['spreadsheetId', 'manualSpreadsheetId'] },
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
      dependsOn: ['credential'],
      mode: 'advanced',
    },
    // Cell Range (optional for read/write)
    {
      id: 'cellRange',
      title: 'Cell Range',
      type: 'short-input',
      placeholder: 'Cell range (e.g., A1:D10). Defaults to used range for read, A1 for write.',
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
  ],
  tools: {
    access: ['microsoft_excel_read_v2', 'microsoft_excel_write_v2'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'microsoft_excel_read_v2'
          case 'write':
            return 'microsoft_excel_write_v2'
          default:
            throw new Error(`Invalid Microsoft Excel V2 operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          values,
          spreadsheetId,
          manualSpreadsheetId,
          sheetName,
          manualSheetName,
          cellRange,
          ...rest
        } = params

        const parsedValues = values ? JSON.parse(values as string) : undefined

        const effectiveSpreadsheetId = (spreadsheetId || manualSpreadsheetId || '').trim()
        const effectiveSheetName = ((sheetName || manualSheetName || '') as string).trim()

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        if (!effectiveSheetName) {
          throw new Error('Sheet name is required. Please select or enter a sheet name.')
        }

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
    credential: { type: 'string', description: 'Microsoft Excel access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier' },
    manualSpreadsheetId: { type: 'string', description: 'Manual spreadsheet identifier' },
    sheetName: { type: 'string', description: 'Name of the sheet/tab' },
    manualSheetName: { type: 'string', description: 'Manual sheet name entry' },
    cellRange: { type: 'string', description: 'Cell range (e.g., A1:D10)' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
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
    metadata: { type: 'json', description: 'Spreadsheet metadata including ID and URL' },
  },
}
