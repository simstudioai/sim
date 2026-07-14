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
import { ConnectorSyncGraphic } from '@/app/(landing)/knowledge/components/feature-graphics/connector-sync-graphic'
import { KnowledgeQueryGraphic } from '@/app/(landing)/knowledge/components/feature-graphics/knowledge-query-graphic'
import { KnowledgeHeroLoop } from '@/app/(landing)/knowledge/components/knowledge-hero-loop'
import { KnowledgeAnswerGraphic } from '@/app/(landing)/solutions/components/feature-graphics'

/**
 * Knowledge Base platform page - a consumer of {@link SolutionsPage}
 * rendered with the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout chrome: identity (for structured data), a
 * hero, and two rows of three cards. The story is agent memory - sync your
 * sources in through connectors, get answers grounded in your own docs
 * with citations, reach the same knowledge from any workflow, and let Sim
 * keep it all fresh on its own. Two knowledge-specific vignettes (the
 * connector ledger and the dark knowledge-search code window) sit beside
 * enterprise graphics retold for knowledge work: the grounded chat answer,
 * the sync-event audit ledger, and the document-processing log panel.
 *
 * The JSON-LD emitted by {@link SolutionsPage} is structurally identical
 * to the platform page's (`WebPage` + `BreadcrumbList` +
 * `WebApplication`), so the feature-tile treatment is SEO-neutral.
 */
const KNOWLEDGE_CONFIG: SolutionsPageConfig = {
  module: 'Knowledge Base',
  path: '/knowledge',
  hero: {
    eyebrow: 'Knowledge Base',
    heading: "Give your agents memory of your company's data in Sim.",
    description:
      "Knowledge Base is your agents' memory in Sim, the open-source AI workspace. Upload docs, sync sources like Notion and Google Drive, and get answers grounded in your own data, with citations.",
    summary:
      'Knowledge Base is the agent-memory module in Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. Teams upload docs or sync sources like Notion, Google Drive, and Confluence, and every agent answers from that data with citations, kept fresh automatically.',
    visual: (
      <PlatformHeroVisual>
        <KnowledgeHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'memory',
      title: 'Give agents memory of your data.',
      subtitle:
        'Sim turns your docs and sources into searchable memory every agent can read, so answers come from your data instead of guesswork.',
      cta: { label: 'Explore Knowledge Base', href: '/signup' },
      cards: [
        {
          title: 'Sync your sources',
          description:
            'Connect Notion, Google Drive, Confluence, and more. Sim pulls the documents in and keeps every source syncing on its own.',
          visual: <ConnectorSyncGraphic />,
        },
        {
          title: 'Answers grounded in your docs',
          description:
            'Agents in Sim answer from your knowledge base and cite the document behind every answer, so teams can check the source.',
          visual: (
            <KnowledgeAnswerGraphic
              question='What is our refund policy for annual plans?'
              answer='Annual plans are refunded pro-rata within 30 days of renewal — after that, the remaining term converts to account credit.'
              sourceLabel='Billing policy'
              sourceDetail='Cited from your knowledge base'
            />
          ),
        },
        {
          title: 'Search knowledge from any workflow',
          description:
            'Drop a knowledge search step into any workflow. Sim retrieves the passages the agent needs mid-run, in visual builds or in code.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <KnowledgeQueryGraphic />,
        },
      ],
    },
    {
      id: 'fresh',
      title: 'Knowledge that stays fresh on its own.',
      subtitle:
        'Sim re-syncs your sources, processes every new document, and logs each update, so agent memory never drifts out of date.',
      cta: { label: 'See how syncing works', href: '/signup' },
      cards: [
        {
          title: 'Fresh without the upkeep',
          description:
            'Sim re-syncs each connected source on a schedule and records every update, so nobody has to re-upload a doc again.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Source synced',
                  actor: 'Notion',
                  resource: '128 docs updated',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Document processed',
                  actor: 'Sim',
                  resource: 'Pricing guide v4',
                  time: '4 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Sync completed',
                  actor: 'Google Drive',
                  resource: '342 docs checked',
                  time: '1h ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Base created',
                  actor: 'Maya Chen',
                  resource: 'Product Documentation',
                  time: 'Jun 2',
                  avatar: '/landing/team-avatar-1.jpg',
                },
              ]}
            />
          ),
        },
        {
          title: 'Watch documents process',
          description:
            'Sim splits each document into searchable passages and shows the work: source, passage count, tokens, and status for every file.',
          visual: (
            <RunMonitoringGraphic
              title='Document details'
              statusLabel='Processing'
              fields={[
                { label: 'Document', value: 'Pricing guide v4.pdf', variant: 'strong' },
                { label: 'Source', value: 'Notion', variant: 'chip' },
                { label: 'Passages', value: '164', variant: 'mono' },
                { label: 'Tokens', value: '48,392', variant: 'mono' },
              ]}
              outputLabel='Processing output'
              outputPairs={[
                { key: 'status', value: '"indexed"' },
                { key: 'passages', value: '164' },
              ]}
            />
          ),
        },
        {
          title: 'One memory for every agent',
          description:
            'Every agent in Sim reads from the same knowledge base — in Chat, in workflows, and in deployed agents — so answers stay consistent.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Notion', 'Drive', 'Confluence']}
              destinationLabels={['Chat', 'Workflows', 'Agents']}
            />
          ),
        },
      ],
    },
  ],
}

export default function Knowledge() {
  return <SolutionsPage config={KNOWLEDGE_CONFIG} cardVariant='featureTile' />
}
