import { GoogleSheetsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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
