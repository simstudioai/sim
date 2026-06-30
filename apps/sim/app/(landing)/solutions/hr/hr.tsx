import { SolutionsPage, type SolutionsPageConfig } from '@/app/(landing)/components'

/**
 * HR solution page - a reference consumer of {@link SolutionsPage}.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside the
 * shared route-group layout. Visual slots are `null`, so each renders the
 * layout's reserved placeholder panel; a real page swaps in its own client
 * island without touching the layout.
 */
const HR_CONFIG: SolutionsPageConfig = {
  module: 'HR',
  path: '/solutions/hr',
  hero: {
    heading: 'Automate onboarding, employee questions, and approvals with Sim agents.',
    description:
      'HR teams build AI agents in Sim, the open-source AI workspace, wired into your HRIS and 1,000+ integrations, so the team spends time on people, not paperwork.',
    summary:
      'Sim is the open-source AI workspace where HR teams build, deploy, and manage AI agents that automate onboarding, employee questions, and approvals, connecting your HRIS and 1,000+ integrations so the team focuses on people, not paperwork.',
    visual: null,
  },
  rows: [
    {
      id: 'onboard',
      title: 'Onboard and support.',
      subtitle: 'Sim agents handle the repetitive people-ops work end to end.',
      cta: { label: 'See HR agents', href: '/signup' },
      cards: [
        {
          title: 'Onboard new hires',
          description:
            'Sim runs the onboarding checklist across every system so day one just works.',
          visual: null,
        },
        {
          title: 'Answer HR questions',
          description:
            'Sim deploys an agent that answers policy and benefits questions from your docs.',
          visual: null,
        },
        {
          title: 'Generate documents',
          description:
            'Sim drafts offer letters and policy docs from your templates automatically.',
          visual: null,
        },
      ],
    },
    {
      id: 'run',
      title: 'Run the team.',
      subtitle: 'Sim keeps people operations moving without the manual chase.',
      cta: { label: 'Explore HR automation', href: '/signup' },
      cards: [
        {
          title: 'Route approvals',
          description:
            'Sim sends PTO and expense requests to the right manager and tracks the response.',
          visual: null,
        },
        {
          title: 'Run surveys',
          description: 'Sim collects and summarizes engagement feedback so trends surface early.',
          visual: null,
        },
        {
          title: 'Build reports',
          description: 'Sim assembles headcount and people reports from your HRIS on schedule.',
          visual: null,
        },
      ],
    },
  ],
}

export default function HrSolution() {
  return <SolutionsPage config={HR_CONFIG} />
}
