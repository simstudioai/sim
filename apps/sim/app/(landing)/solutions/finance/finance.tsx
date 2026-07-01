import { SolutionsPage, type SolutionsPageConfig } from '@/app/(landing)/components'

/**
 * Finance solution page - a reference consumer of {@link SolutionsPage}.
 *
 * The whole page is one typed {@link SolutionsPageConfig}; the shared
 * route-group layout provides the chrome. Visual slots are `null`, so each
 * renders the layout's reserved placeholder panel; a real page swaps in its own
 * client island without touching the layout.
 */
const FINANCE_CONFIG: SolutionsPageConfig = {
  module: 'Finance',
  path: '/solutions/finance',
  hero: {
    heading: 'Automate invoice processing, reconciliation, and close with Sim agents.',
    description:
      'Finance teams build AI agents in Sim, the open-source AI workspace, with human approvals, anomaly detection, and full audit trails, across 1,000+ integrations and every major LLM.',
    summary:
      'Sim is the open-source AI workspace where finance teams build, deploy, and manage AI agents that automate reconciliation, invoice processing, and reporting, with human approvals, anomaly detection, and full audit trails across 1,000+ integrations.',
    visual: null,
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
          visual: null,
        },
        {
          title: 'Process invoices',
          description:
            'Sim reads, codes, and routes invoices for approval without manual data entry.',
          visual: null,
        },
        {
          title: 'Build reports',
          description:
            'Sim assembles recurring financial reports from your source systems on schedule.',
          visual: null,
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
          visual: null,
        },
        {
          title: 'Detect anomalies',
          description: 'Sim watches spend and flags unusual transactions before they post.',
          visual: null,
        },
        {
          title: 'Keep audit trails',
          description: 'Sim logs every run block by block, so finance can prove every control.',
          visual: null,
        },
      ],
    },
  ],
}

export default function FinanceSolution() {
  return <SolutionsPage config={FINANCE_CONFIG} />
}
