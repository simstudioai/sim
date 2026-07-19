import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AuditTrailGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
  StagingGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { DocumentDraftGraphic } from '@/app/(landing)/solutions/components/feature-graphics'
import { ReconcileGraphic } from '@/app/(landing)/solutions/finance/components/feature-graphics/reconcile-graphic'
import { FinanceHeroLoop } from '@/app/(landing)/solutions/finance/components/finance-hero-loop'

/**
 * Finance solution page - a consumer of {@link SolutionsPage} rendered with
 * the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries a
 * feature graphic in the enterprise design language - enterprise graphics
 * retold through their content props for finance's use cases (invoice
 * routing, approval gates, spend monitoring, the finance audit ledger),
 * plus one finance-specific vignette, the reconciliation match ledger.
 */
/** Meta description shared between the page metadata and the page JSON-LD. */
export const FINANCE_PAGE_DESCRIPTION =
  'AI agents for finance teams: automate invoice processing, reconciliation, and financial reporting. Built in Sim, the open-source AI workspace.'

const FINANCE_CONFIG: SolutionsPageConfig = {
  module: 'Finance',
  path: '/solutions/finance',
  seoDescription: FINANCE_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Finance',
    heading: 'Automate invoice processing, reconciliation, and close with AI agents in Sim.',
    description:
      'Sim is the open-source AI workspace where finance teams build AI agents for invoice processing, reconciliation, and close. Human approvals, anomaly detection, and full audit trails guard every run.',
    summary:
      'Sim is the open-source AI workspace where finance teams build, deploy, and manage AI agents for invoice processing, reconciliation, and financial reporting. Agents run with human approvals, anomaly detection, and full audit trails across 1,000+ integrations.',
    visual: (
      <PlatformHeroVisual>
        <FinanceHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'close',
      title: 'Close the books faster.',
      subtitle: 'Sim agents handle the manual reconciliation work every cycle.',
      cta: { label: 'See finance agents', href: '/signup' },
      cards: [
        {
          title: 'Reconcile accounts',
          description:
            'Sim matches transactions across systems and flags only the exceptions for review.',
          visual: <ReconcileGraphic />,
        },
        {
          title: 'Process invoices',
          description:
            'Sim reads, codes, and routes invoices for approval without manual data entry.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Gmail', 'Drive', 'Stripe']}
              destinationLabels={['NetSuite', 'Approvals', 'Sheets']}
            />
          ),
        },
        {
          title: 'Build reports',
          description:
            'Sim assembles recurring financial reports from your source systems on schedule.',
          visual: (
            <DocumentDraftGraphic
              title='Monthly close'
              statusTag='On schedule'
              footerLabel='Sent to controller'
              footerDetail='Aug 1'
            />
          ),
        },
      ],
    },
    {
      id: 'control',
      title: 'Stay in control.',
      subtitle: 'Sim keeps a human in the loop and a record of every decision.',
      cta: { label: 'Explore controls', href: '/signup' },
      cards: [
        {
          title: 'Route approvals',
          description: 'Sim sends the right items to the right approver and waits before it acts.',
          visual: (
            <StagingGraphic
              title='Invoice'
              headerTag='#2041'
              changeTag='Acme Co'
              changeTitle='$12,400 · Net 30'
              attribution='Routed by Sim · 2m ago'
              checks={['Within approval limit', 'Vendor verified', 'GL code matched']}
              fromLabel='Pending'
              toLabel='Approved'
              actionLabel='Approve'
            />
          ),
        },
        {
          title: 'Detect anomalies',
          description: 'Sim watches spend and flags unusual transactions before they post.',
          visual: (
            <RunMonitoringGraphic
              title='Spend monitor'
              fields={[
                { label: 'Account', value: 'Corporate cards', variant: 'strong' },
                { label: 'Alert', value: 'Duplicate charge', variant: 'chip' },
                { label: 'Amount', value: '$1,982.00', variant: 'mono' },
                { label: 'Confidence', value: '98%', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'status', value: '"flagged"' },
                { key: 'holds', value: '2' },
              ]}
            />
          ),
        },
        {
          title: 'Keep audit trails',
          description: 'Sim logs every run block by block, so finance can prove every control.',
          visual: (
            <AuditTrailGraphic
              entries={[
                {
                  action: 'Invoice approved',
                  actor: 'Maya Chen',
                  resource: 'Acme Co · $12,400',
                  time: 'Now',
                  avatar: '/landing/team-avatar-1.jpg',
                },
                {
                  action: 'Journal entry posted',
                  actor: 'Jordan Lee',
                  resource: 'GL 6010',
                  time: '14 min ago',
                  avatar: '/landing/team-avatar-2.jpg',
                },
                {
                  action: 'Credential accessed',
                  actor: 'Sam Ortiz',
                  resource: 'NetSuite OAuth',
                  time: '1h ago',
                  avatar: '/landing/team-avatar-3.jpg',
                },
                {
                  action: 'Workflow created',
                  actor: 'Maya Chen',
                  resource: 'Close agent',
                  time: 'Jun 2',
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

export default function FinanceSolution() {
  return <SolutionsPage config={FINANCE_CONFIG} />
}
