import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import {
  EnrichmentFillGraphic,
  TableGridGraphic,
  TableQueryGraphic,
} from '@/app/(landing)/tables/components/feature-graphics'
import { TablesHeroLoop } from '@/app/(landing)/tables/components/tables-hero-loop'

/**
 * Tables platform page - a consumer of {@link SolutionsPage} rendered
 * with the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout chrome: identity (for structured data), a
 * hero, and two rows of three cards. Every visual slot carries a feature
 * graphic in the enterprise design language - three tables-specific
 * vignettes (the cropped Leads grid, the enrichment ledger, and the dark
 * query-window twin of the workflows page's code tile) plus the
 * monitoring panel, switchboard, and audit ledger retold for runs writing
 * rows, data routing into tables, and row-change history.
 *
 * The JSON-LD emitted by {@link SolutionsPage} is structurally identical
 * to the platform page's (`WebPage` + `BreadcrumbList` +
 * `WebApplication`), so the switch to feature tiles is SEO-neutral.
 */
const TABLES_CONFIG: SolutionsPageConfig = {
  module: 'Tables',
  path: '/tables',
  hero: {
    eyebrow: 'Tables',
    heading: 'Power agents with structured data in Sim.',
    description:
      'Tables is the database built into Sim, the open-source AI workspace. Store the records agents read and write, let enrichments fill empty cells, and carry state from one run to the next.',
    summary:
      'Tables is the built-in database in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Teams store records agents read and write, run enrichments that fill cells automatically, query rows from agent logic, and keep state between runs, all in one workspace.',
    visual: (
      <PlatformHeroVisual>
        <TablesHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'records',
      title: 'Give agents structured data to act on.',
      subtitle:
        'Sim stores the records agents work with, leads, tickets, and invoices, as tables that live in the same workspace as the agents themselves.',
      cta: { label: 'Explore Tables', href: '/signup' },
      cards: [
        {
          title: 'Records agents act on',
          description:
            'Store leads, tickets, and invoices as rows agents read and write. Sim keeps the data next to the agents that work it.',
          visual: <TableGridGraphic />,
        },
        {
          title: 'Enrichments fill the blanks',
          description:
            'Sim runs enrichments over new rows, finding work emails, phone numbers, and company info, so empty cells fill themselves.',
          visual: <EnrichmentFillGraphic />,
        },
        {
          title: 'Query from agent logic',
          description:
            'Read and write rows from code or any workflow block. Sim treats every table as part of your agent logic.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <TableQueryGraphic />,
        },
      ],
    },
    {
      id: 'memory',
      title: 'Tables are your agents’ memory.',
      subtitle:
        'Sim carries state between runs. Every run writes rows, every change is recorded, and agents pick up exactly where they left off.',
      cta: { label: 'See how agents use Tables', href: '/signup' },
      cards: [
        {
          title: 'State between runs',
          description:
            'Each run writes its results back to the table, so the next run starts from what Sim already knows.',
          visual: (
            <RunMonitoringGraphic
              fields={[
                { label: 'Workflow', value: 'Lead enrichment', variant: 'strong' },
                { label: 'Table', value: 'leads', variant: 'chip' },
                { label: 'Operation', value: 'Insert', variant: 'chip' },
                { label: 'Rows written', value: '32', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'status', value: '"completed"' },
                { key: 'rows_written', value: '32' },
              ]}
            />
          ),
        },
        {
          title: 'Wire data in and out',
          description:
            'Sim routes records from your tools into tables and back out again, one switchboard for structured data.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Stripe', 'Salesforce', 'Gmail']}
              destinationLabels={['leads', 'invoices', 'tickets']}
            />
          ),
        },
        {
          title: 'Every change recorded',
          description:
            'Sim records every insert and update with who made it, so the history of a table is always inspectable.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Row updated',
                  actor: 'Support agent',
                  resource: 'leads · Acme Co',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Rows inserted',
                  actor: 'Lead intake',
                  resource: 'leads · 5 rows',
                  time: '2 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Enrichment completed',
                  actor: 'Lead enrichment',
                  resource: 'leads · Work email',
                  time: '12 min ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Table created',
                  actor: 'Maya Chen',
                  resource: 'leads',
                  time: 'Jun 14',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function Tables() {
  return <SolutionsPage config={TABLES_CONFIG} cardVariant='featureTile' />
}
