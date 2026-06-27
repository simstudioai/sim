import { MicrosoftExcelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MicrosoftExcelBlockDisplay = {
  type: 'microsoft_excel',
  name: 'Microsoft Excel (Legacy)',
  description: 'Read, write, and update data',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  longDescription:
    'Integrate Microsoft Excel into the workflow. Can read, write, update, add to table, and create new worksheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const MicrosoftExcelV2BlockDisplay = {
  type: 'microsoft_excel_v2',
  name: 'Microsoft Excel',
  description: 'Read and write data with sheet selection',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftExcelIcon,
  longDescription:
    'Integrate Microsoft Excel into the workflow with explicit sheet selection. Can read and write data in specific sheets.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_excel',
  integrationType: IntegrationType.Documents,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const MicrosoftExcelBlockMeta = {
  tags: ['spreadsheet', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/excel',
  templates: [
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel financial close automator',
      prompt:
        'Build a scheduled workflow that closes the books each period — pulls Stripe and accounting data, updates a Microsoft Excel close workbook, and emails the controller the reconciled file.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['stripe', 'gmail'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel invoice generator',
      prompt:
        'Create a workflow that reads a sales orders table, populates a Microsoft Excel invoice template per order, and saves the file to a SharePoint folder for finance review.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel pivot refresher',
      prompt:
        'Build a scheduled workflow that refreshes a Microsoft Excel pivot table from a SQL source, exports the rendered snapshot, and posts the file link to a Microsoft Teams channel.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel + SharePoint forecast hub',
      prompt:
        'Create a workflow that aggregates regional forecasts submitted in Microsoft Excel files on SharePoint, normalizes formats, and writes a consolidated forecast table for leadership.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['sharepoint'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel commission calculator',
      prompt:
        'Build a workflow that pulls closed Salesforce deals each month, computes commission per rep using a Microsoft Excel commission model, and emails the per-rep statements.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'finance'],
      alsoIntegrations: ['salesforce', 'gmail'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel scenario modeler',
      prompt:
        'Create a workflow that runs scenarios against a Microsoft Excel financial model — pessimistic, base, optimistic — captures outputs, and writes a comparison report to a finance file.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
    {
      icon: MicrosoftExcelIcon,
      title: 'Excel + Power BI feeder',
      prompt:
        'Build a scheduled workflow that updates a Microsoft Excel data table from a Sim source, refreshes the dependent Power BI dataset, and notifies BI consumers in Teams.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'read-sheet-range',
      description: 'Read data from a Microsoft Excel worksheet range and return the rows.',
      content:
        '# Read Sheet Range\n\nPull data out of an Excel workbook for analysis or downstream steps.\n\n## Steps\n1. Identify the workbook and the worksheet and range to read.\n2. Use Read Data with the spreadsheet ID and range.\n3. Parse the returned rows into a structured form for the next step.\n\n## Output\nThe values from the range as rows, plus the sheet and range they came from.',
    },
    {
      name: 'write-sheet-data',
      description:
        'Write or update values in a Microsoft Excel worksheet range, with formula parsing control.',
      content:
        '# Write Sheet Data\n\nUpdate cells in an Excel workbook.\n\n## Steps\n1. Identify the workbook, worksheet, and target range.\n2. Prepare the values as rows matching the range shape.\n3. Use Write/Update Data, choosing User Entered to parse formulas or Raw to write values literally.\n\n## Output\nConfirmation of the cells updated and the range that was written.',
    },
    {
      name: 'append-table-row',
      description:
        'Append a new row to a Microsoft Excel table so it stays structured and formatted.',
      content:
        '# Append Table Row\n\nAdd a record to an existing Excel table.\n\n## Steps\n1. Identify the workbook and the table to append to.\n2. Build the row values in the table column order.\n3. Use Add to Table to append the row so table formatting and references update automatically.\n\n## Output\nConfirmation the row was appended and the table it was added to.',
    },
    {
      name: 'add-worksheet',
      description:
        'Add a new worksheet to a Microsoft Excel workbook to hold a new dataset or report.',
      content:
        '# Add Worksheet\n\nCreate a fresh worksheet inside a workbook.\n\n## Steps\n1. Identify the workbook to add the sheet to.\n2. Choose a name for the new worksheet.\n3. Use Add Worksheet to create it, then write headers or data with Write/Update Data if needed.\n\n## Output\nThe new worksheet name and confirmation it was created in the workbook.',
    },
  ],
} as const satisfies BlockMeta

export const MicrosoftExcelV2BlockMeta = {
  tags: ['spreadsheet', 'microsoft-365'],
  url: 'https://www.microsoft.com/microsoft-365/excel',
} as const satisfies BlockMeta
