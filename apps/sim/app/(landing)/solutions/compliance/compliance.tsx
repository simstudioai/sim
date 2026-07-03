import { SolutionsPage, type SolutionsPageConfig } from '@/app/(landing)/components'

/**
 * Compliance solution page - a reference consumer of {@link SolutionsPage}.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside the
 * shared route-group layout's chrome. Visual slots are `null`, so each renders the
 * layout's reserved placeholder panel; a real page swaps in its own client
 * island without touching the layout.
 */
const COMPLIANCE_CONFIG: SolutionsPageConfig = {
  module: 'Compliance',
  path: '/solutions/compliance',
  hero: {
    heading: 'Automate evidence, control checks, and audit reports with Sim agents.',
    description:
      'Compliance teams build AI agents in Sim, the open-source AI workspace, that monitor controls and assemble a clean, defensible record, keeping the organization continuously audit-ready instead of scrambling once a year.',
    summary:
      'Sim is the open-source AI workspace where compliance teams build, deploy, and manage AI agents that automate evidence collection, control monitoring, and reporting, keeping the organization continuously audit-ready across 1,000+ integrations.',
    visual: null,
  },
  rows: [
    {
      id: 'evidence',
      title: 'Automate the evidence.',
      subtitle: 'Sim agents collect and check the proof so audits stop being fire drills.',
      cta: { label: 'See compliance agents', href: '/signup' },
      cards: [
        {
          title: 'Collect evidence',
          description:
            'Sim gathers screenshots, logs, and records from your systems on a schedule.',
          visual: null,
        },
        {
          title: 'Monitor controls',
          description: 'Sim continuously checks controls and flags drift the moment it appears.',
          visual: null,
        },
        {
          title: 'Check policies',
          description:
            'Sim reviews changes against your policies and raises anything out of bounds.',
          visual: null,
        },
      ],
    },
    {
      id: 'prove',
      title: 'Prove control.',
      subtitle: 'Sim turns continuous monitoring into a clean, defensible record.',
      cta: { label: 'Explore reporting', href: '/signup' },
      cards: [
        {
          title: 'Review access',
          description: 'Sim runs periodic access reviews and routes exceptions for sign-off.',
          visual: null,
        },
        {
          title: 'Generate reports',
          description:
            'Sim assembles audit-ready reports from live evidence, not stale spreadsheets.',
          visual: null,
        },
        {
          title: 'Trace every action',
          description: 'Sim logs every run block by block, so auditors see exactly what happened.',
          visual: null,
        },
      ],
    },
  ],
}

export default function ComplianceSolution() {
  return <SolutionsPage config={COMPLIANCE_CONFIG} />
}
