import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import { TablesEnrichmentPreview } from '@/app/(landing)/tables/components/tables-enrichment-preview'
import { TablesRecordsPreview } from '@/app/(landing)/tables/components/tables-records-preview'
import { TablesWorkflowPreview } from '@/app/(landing)/tables/components/tables-workflow-preview'

/** Shared description for page metadata and structured data. */
export const TABLES_PAGE_DESCRIPTION =
  'Give AI agents structured data with Sim Tables. Organize records, enrich rows, run workflows from columns, and read or write data between agent runs.'

const TABLES_CONFIG: SolutionsProductPageConfig = {
  module: 'Tables',
  path: '/tables',
  seoDescription: TABLES_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Tables',
    heading: 'Put your data to work with AI agents.',
    description: 'Organize, enrich, and put structured data to work across every agent run in Sim.',
    visual: <ProductHeroPreview product='tables' />,
    summary:
      'Sim Tables is the built-in database in the open-source AI workspace where teams build, deploy, and manage AI agents. Teams organize typed records, filter and edit rows, add enrichment and workflow columns, and use Table blocks to query, insert, and update data across agent runs.',
  },
  codeExample: {
    title: 'Work with data from your terminal.',
    description:
      'Find your tables and query their rows with the Sim CLI. Use the results in your own scripts and tools.',
    filename: 'tables.sh',
    commands: ['sim tables list', 'sim tables rows query \\', '  "$TABLE_ID" --limit 10'],
  },
  features: [
    {
      id: 'records',
      label: 'Structured records',
      title: 'A working home for your data.',
      description: 'Filter records, inspect a row, and keep the data your agents use organized.',
      visual: <TablesRecordsPreview />,
      cta: { label: 'Explore Tables', href: 'https://docs.sim.ai/tables' },
    },
    {
      id: 'enrich',
      label: 'Enrichment and workflows',
      title: 'Fill in the missing context.',
      description:
        'Enrich a row or run a workflow to write research, scores, and details back into your table.',
      visual: <TablesEnrichmentPreview />,
      cta: {
        label: 'Explore workflow columns',
        href: 'https://docs.sim.ai/tables/workflow-columns',
      },
    },
    {
      id: 'state',
      label: 'Data across runs',
      title: 'Carry work from run to run.',
      description:
        'Read matching records and save results with Table blocks inside your workflows.',
      visual: <TablesWorkflowPreview />,
      cta: {
        label: 'See Tables in workflows',
        href: 'https://docs.sim.ai/tables/using-in-workflows',
      },
    },
  ],
}

export default function Tables() {
  return <SolutionsPage config={TABLES_CONFIG} />
}
