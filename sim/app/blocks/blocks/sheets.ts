import { GoogleSheetsIcon } from '@/components/icons'
import {
  GoogleSheetsReadResponse,
  GoogleSheetsUpdateResponse,
  GoogleSheetsWriteResponse,
} from '@/tools/sheets/types'
import { BlockConfig } from '../types'

type GoogleSheetsResponse =
  | GoogleSheetsReadResponse
  | GoogleSheetsWriteResponse
  | GoogleSheetsUpdateResponse

export const GoogleSheetsBlock: BlockConfig<GoogleSheetsResponse> = {
  type: 'google_sheets',
  name: 'Google Sheets',
  description: 'Read, write, and update data',
  longDescription:
    'Integrate Google Sheets functionality to manage spreadsheet data. Read data from specific ranges, write new data, and update existing cells using OAuth authentication. Supports various input and output formats for flexible data handling.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleSheetsIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Data', id: 'read' },
        { label: 'Write Data', id: 'write' },
        { label: 'Update Data', id: 'update' },
      ],
    },
    // Google Sheets Credentials
    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'google-sheets',
      serviceId: 'google-sheets',
      requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
      placeholder: 'Select Google account',
    },
    // Spreadsheet Selector
    {
      id: 'spreadsheetId',
      title: 'Select Sheet',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.spreadsheet',
      placeholder: 'Select a spreadsheet',
    },
    // Manual Spreadsheet ID (hidden by default)
    {
      id: 'manualSpreadsheetId',
      title: 'Or Enter Spreadsheet ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the spreadsheet (from URL)',
      condition: { field: 'spreadsheetId', value: '' },
    },
    // Range
    {
      id: 'range',
      title: 'Range',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Sheet name and cell range (e.g., Sheet1!A1:D10)',
    },
    // Write-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]])',
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
    // Update-specific Fields
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter values as JSON array of arrays (e.g., [["A1", "B1"], ["A2", "B2"]])',
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
  ],
  tools: {
    access: ['google_sheets_read', 'google_sheets_write', 'google_sheets_update'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'google_sheets_read'
          case 'write':
            return 'google_sheets_write'
          case 'update':
            return 'google_sheets_update'
          default:
            throw new Error(`Invalid Google Sheets operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, values, spreadsheetId, manualSpreadsheetId, ...rest } = params

        // Parse values from JSON string to array if it exists
        const parsedValues = values ? JSON.parse(values as string) : undefined

        // Use the selected spreadsheet ID or the manually entered one
        // If spreadsheetId is provided, it's from the file selector and contains the file ID
        // If not, fall back to manually entered ID
        const effectiveSpreadsheetId = (spreadsheetId || manualSpreadsheetId || '').trim()

        if (!effectiveSpreadsheetId) {
          throw new Error(
            'Spreadsheet ID is required. Please select a spreadsheet or enter an ID manually.'
          )
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
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    spreadsheetId: { type: 'string', required: false },
    manualSpreadsheetId: { type: 'string', required: false },
    range: { type: 'string', required: false },
    // Write/Update operation inputs
    values: { type: 'string', required: false },
    valueInputOption: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        data: 'json',
        metadata: 'json',
        updatedRange: 'string',
        updatedRows: 'number',
        updatedColumns: 'number',
        updatedCells: 'number',
      },
    },
  },
}
