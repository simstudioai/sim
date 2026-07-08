import { GoogleSheetsIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const googleSheetsConnectorMeta: ConnectorMeta = {
  id: 'google_sheets',
  name: 'Google Sheets',
  description: 'Sync spreadsheet data from Google Sheets',
  version: '1.0.0',
  icon: GoogleSheetsIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-sheets',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
  },

  configFields: [
    {
      id: 'spreadsheetSelector',
      title: 'Spreadsheet',
      type: 'selector',
      selectorKey: 'google.drive',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      canonicalParamId: 'spreadsheetId',
      mode: 'basic',
      placeholder: 'Select a spreadsheet',
      required: true,
    },
    {
      id: 'spreadsheetId',
      title: 'Spreadsheet ID',
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      mode: 'advanced',
      placeholder: 'e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      required: true,
      description: 'The ID from the spreadsheet URL: docs.google.com/spreadsheets/d/{ID}/edit',
    },
    {
      id: 'sheetFilter',
      title: 'Sheets to Sync',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All sheets', id: 'all' },
        { label: 'First sheet only', id: 'first' },
      ],
    },
  ],

  tagDefinitions: [
    { id: 'sheetTitle', displayName: 'Sheet Name', fieldType: 'text' },
    { id: 'rowCount', displayName: 'Row Count', fieldType: 'number' },
    { id: 'columnCount', displayName: 'Column Count', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
