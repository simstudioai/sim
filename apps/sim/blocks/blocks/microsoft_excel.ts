import { MicrosoftExcelIcon } from '@/components/icons'
import type {
  MicrosoftExcelReadResponse,
  MicrosoftExcelTableAddResponse,
  MicrosoftExcelWriteResponse,
} from '@/tools/microsoft_excel/types'
import type { BlockConfig } from '../types'

type MicrosoftExcelResponse =
  | MicrosoftExcelReadResponse
  | MicrosoftExcelWriteResponse
  | MicrosoftExcelTableAddResponse

export const MicrosoftExcelBlock: BlockConfig<MicrosoftExcelResponse> = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel',
  description: 'Read, write, and update data',
  longDescription:
    'Integrate Microsoft Excel functionality to manage spreadsheet data. Read data from specific ranges, write new data, update existing cells, and manipulate table data using OAuth authentication. Supports various input and output formats for flexible data handling.',
  docsLink: 'https://docs.simstudio.ai/tools/microsoft_excel',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftExcelIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write/Update Data', id: 'write' },
        { label: 'Add to Table', id: 'table_add' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'microsoft-excel',
      serviceId: 'microsoft-excel',
      requiredScopes: [],
      placeholder: 'Select Microsoft account',
    },
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      type: 'file-selector',
      layout: 'full',
      provider: 'microsoft-excel',
      serviceId: 'microsoft-excel',
      requiredScopes: [],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      placeholder: 'Select a spreadsheet',
    },
    {
      id: 'manualSpreadsheetId',
      title: 'Or Enter Spreadsheet ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the spreadsheet (from URL)',
      condition: { field: 'spreadsheetId', value: '' },
    },
    {
      id: 'range',
      title: 'Range',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Sheet name and cell range (e.g., Sheet1!A1:D10)',
      condition: { field: 'operation', value: ['read', 'write', 'update'] },
    },
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the Excel table',
      condition: { field: 'operation', value: ['table_add'] },
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'valueInputOption',
      title: 'Value Input Option',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'valueInputOption',
      title: 'Value Input Option',
      type: 'dropdown',
      layout: 'full',
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
      layout: 'full',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]]) or an array of objects (e.g., [{"name":"John", "age":30}, {"name":"Jane", "age":25}])',
      condition: { field: 'operation', value: 'table_add' },
    },
  ],
  tools: {
    access: ['microsoft_excel_read', 'microsoft_excel_write', 'microsoft_excel_table_add'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'microsoft_excel_read'
          case 'write':
            return 'microsoft_excel_write'
          case 'table_add':
            return 'microsoft_excel_table_add'
          default:
            throw new Error(`Invalid Microsoft Excel operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, values, spreadsheetId, manualSpreadsheetId, tableName, ...rest } =
          params

        // Parse values from JSON string to array if it exists
        let parsedValues
        try {
          parsedValues = values ? JSON.parse(values as string) : undefined
        } catch (error) {
          throw new Error('Invalid JSON format for values')
        }

        // Use the selected spreadsheet ID or the manually entered one
        const effectiveSpreadsheetId = (spreadsheetId || manualSpreadsheetId || '').trim()

        if (!effectiveSpreadsheetId) {
          throw new Error(
            'Spreadsheet ID is required. Please select a spreadsheet or enter an ID manually.'
          )
        }

        // For table operations, ensure tableName is provided
        if (params.operation === 'table_add' && !tableName) {
          throw new Error('Table name is required for table operations.')
        }

        const baseParams = {
          ...rest,
          spreadsheetId: effectiveSpreadsheetId,
          values: parsedValues,
          credential,
        }

        // Add table-specific parameters
        if (params.operation === 'table_add') {
          return {
            ...baseParams,
            tableName,
          }
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    spreadsheetId: { type: 'string', required: false },
    manualSpreadsheetId: { type: 'string', required: false },
    range: { type: 'string', required: false },
    tableName: { type: 'string', required: false },
    values: { type: 'string', required: false },
    valueInputOption: { type: 'string', required: false },
  },
  outputs: {
    data: 'json',
    metadata: 'json',
    updatedRange: 'string',
    updatedRows: 'number',
    updatedColumns: 'number',
    updatedCells: 'number',
    index: 'number',
    values: 'json',
  },
}
