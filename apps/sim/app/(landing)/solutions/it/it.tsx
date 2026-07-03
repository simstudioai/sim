import { SolutionsPage, type SolutionsPageConfig } from '@/app/(landing)/components'

/**
 * IT solution page - a reference consumer of {@link SolutionsPage}.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside the
 * shared route-group layout's chrome. Visual slots are `null`, so each renders
 * the layout's reserved placeholder panel; a real page swaps in its own client
 * island without touching the layout.
 */
const IT_CONFIG: SolutionsPageConfig = {
  module: 'IT',
  path: '/solutions/it',
  hero: {
    heading: 'Automate ticket triage, access, and monitoring with Sim agents.',
    description:
      'IT teams build AI agents in Sim, the open-source AI workspace, with the governance, access controls, and audit trails IT needs, across 1,000+ integrations and every major LLM.',
    summary:
      'Sim is the open-source AI workspace where IT teams build, deploy, and manage AI agents that automate ticket triage, access provisioning, and infrastructure monitoring, connecting 1,000+ integrations and every major LLM under IT-grade governance.',
    visual: null,
  },
  rows: [
    {
      id: 'service-desk',
      title: 'Automate the service desk.',
      subtitle: 'Sim agents handle the repetitive front line so your team works on what matters.',
      cta: { label: 'See IT agents', href: '/signup' },
      cards: [
        {
          title: 'Triage tickets',
          description:
            'Sim routes, tags, and resolves incoming tickets across your help desk automatically.',
          visual: null,
        },
        {
          title: 'Provision access',
          description:
            'Sim grants and revokes access by policy, so requests are handled in seconds, not days.',
          visual: null,
        },
        {
          title: 'Answer common questions',
          description: 'Sim deploys an internal help-desk agent that answers from your own docs.',
          visual: null,
        },
      ],
    },
    {
      id: 'reliability',
      title: 'Keep systems healthy.',
      subtitle: 'Sim watches your stack and acts before small issues become outages.',
      cta: { label: 'Explore monitoring', href: '/signup' },
      cards: [
        {
          title: 'Monitor infrastructure',
          description:
            'Sim agents watch logs and metrics and flag anomalies the moment they appear.',
          visual: null,
        },
        {
          title: 'Respond to incidents',
          description:
            'Sim runs your runbooks automatically and escalates to the right on-call engineer.',
          visual: null,
        },
        {
          title: 'Audit every action',
          description:
            'Sim logs every agent run block by block, so IT can prove exactly what happened.',
          visual: null,
        },
      ],
    },
  ],
}

export default function ItSolution() {
  return <SolutionsPage config={IT_CONFIG} />
}
