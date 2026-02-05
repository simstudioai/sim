import { MicrosoftExcelIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type {
  MicrosoftExcelResponse,
  MicrosoftExcelV2Response,
} from '@/tools/microsoft_excel/types'

export const MicrosoftExcelBlock: BlockConfig<MicrosoftExcelResponse> = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel (Legacy)',
  description: 'Read, write, and update data',
  authMode: AuthMode.OAuth,
  hideFromToolbar: true,
  longDescription:
    'Integrate Microsoft Excel into the workflow. Can read, write, update, add to table, and create new worksheets.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_excel',
  category: 'tools',
  bgColor: '#E0E0E0',
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
      ],
      value: () => 'read',
    },
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
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      type: 'file-selector',
      canonicalParamId: 'spreadsheetId',
      serviceId: 'microsoft-excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Select a spreadsheet',
      dependsOn: ['credential'],
      mode: 'basic',
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
      condition: { field: 'operation', value: ['read', 'write', 'update'] },
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
      placeholder: 'Name of the new worksheet (max 31 characters)',
      condition: { field: 'operation', value: ['worksheet_add'] },
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
  ],
  tools: {
    access: [
      'microsoft_excel_read',
      'microsoft_excel_write',
      'microsoft_excel_table_add',
      'microsoft_excel_worksheet_add',
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
          default:
            throw new Error(`Invalid Microsoft Excel operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, values, spreadsheetId, tableName, worksheetName, ...rest } = params

        // Use canonical param ID (raw subBlock IDs are deleted after serialization)
        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''

        let parsedValues
        try {
          parsedValues = values ? JSON.parse(values as string) : undefined
        } catch (error) {
          throw new Error('Invalid JSON format for values')
        }

        if (!effectiveSpreadsheetId) {
          throw new Error('Spreadsheet ID is required.')
        }

        if (params.operation === 'table_add' && !tableName) {
          throw new Error('Table name is required for table operations.')
        }

        if (params.operation === 'worksheet_add' && !worksheetName) {
          throw new Error('Worksheet name is required for worksheet operations.')
        }

        const baseParams = {
          ...rest,
          spreadsheetId: effectiveSpreadsheetId,
          values: parsedValues,
          credential,
        }

        if (params.operation === 'table_add') {
          return {
            ...baseParams,
            tableName,
          }
        }

        if (params.operation === 'worksheet_add') {
          return {
            ...baseParams,
            worksheetName,
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft Excel access token' },
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    range: { type: 'string', description: 'Cell range' },
    tableName: { type: 'string', description: 'Table name' },
    worksheetName: { type: 'string', description: 'Worksheet name' },
    values: { type: 'string', description: 'Cell values data' },
    valueInputOption: { type: 'string', description: 'Value input option' },
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
      tool: createVersionedToolSelector({
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
      }),
      params: (params) => {
        const { credential, values, spreadsheetId, sheetName, cellRange, ...rest } = params

        const parsedValues = values ? JSON.parse(values as string) : undefined

        // Use canonical param IDs (raw subBlock IDs are deleted after serialization)
        const effectiveSpreadsheetId = spreadsheetId ? String(spreadsheetId).trim() : ''
        const effectiveSheetName = sheetName ? String(sheetName).trim() : ''

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
    spreadsheetId: { type: 'string', description: 'Spreadsheet identifier (canonical param)' },
    sheetName: { type: 'string', description: 'Name of the sheet/tab (canonical param)' },
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
