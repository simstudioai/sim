import { MicrosoftExcelIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const microsoftExcelConnectorMeta: ConnectorMeta = {
  id: 'microsoft_excel',
  name: 'Microsoft Excel',
  description: 'Sync workbook sheet data from Microsoft Excel',
  version: '1.0.0',
  icon: MicrosoftExcelIcon,

  auth: {
    mode: 'oauth',
    provider: 'microsoft-excel',
    requiredScopes: ['Files.ReadWrite'],
  },

  /**
   * No config field caps the listing: every worksheet of the one workbook is
   * listed. The `MAX_WORKSHEETS` memory bound flags `listingCapped` when it
   * bites, which the members-mode crawl reads as an incomplete listing.
   */
  permissionScopedListing: { capFieldIds: [] },
  configFields: [
    {
      id: 'driveId',
      title: 'Drive ID (SharePoint)',
      type: 'short-input',
      required: false,
      placeholder: 'Leave empty for your own OneDrive',
      description:
        'The SharePoint document library (drive) ID holding the workbook. Leave empty to use your own OneDrive for Business. Workbooks stored in consumer OneDrive are not supported by the Excel API.',
    },
    {
      id: 'spreadsheetSelector',
      title: 'Workbook',
      type: 'selector',
      selectorKey: 'microsoft.excel',
      canonicalParamId: 'spreadsheetId',
      mode: 'basic',
      dependsOn: ['driveId'],
      placeholder: 'Select a workbook',
      required: true,
    },
    {
      id: 'spreadsheetId',
      title: 'Workbook ID',
      type: 'short-input',
      canonicalParamId: 'spreadsheetId',
      mode: 'advanced',
      dependsOn: ['driveId'],
      placeholder: 'e.g. 01ABC123DEF456',
      required: true,
      description: 'The Microsoft Graph drive item ID of the .xlsx workbook',
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
