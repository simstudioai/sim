import { GoogleSheetsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleSheetsBlockDisplay = {
  type: 'google_sheets',
  name: 'Google Sheets (Legacy)',
  description: 'Read, write, and update data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleSheetsIcon,
  longDescription:
    'Integrate Google Sheets into the workflow. Can read, write, append, and update data.',
  docsLink: 'https://docs.sim.ai/integrations/google_sheets',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const GoogleSheetsV2BlockDisplay = {
  type: 'google_sheets_v2',
  name: 'Google Sheets',
  description: 'Read, write, and update data with sheet selection',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleSheetsIcon,
  longDescription:
    'Integrate Google Sheets into the workflow with explicit sheet selection. Can read, write, append, update, clear data, create spreadsheets, get spreadsheet info, and copy sheets.',
  docsLink: 'https://docs.sim.ai/integrations/google_sheets',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay
