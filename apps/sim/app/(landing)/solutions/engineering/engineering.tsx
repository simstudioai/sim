import { SolutionsPage, type SolutionsPageConfig } from '@/app/(landing)/components'

/**
 * Engineering solution page - a reference consumer of {@link SolutionsPage}.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside the
 * shared route-group layout's chrome. Visual slots are `null`, so each renders the
 * layout's reserved placeholder panel; a real page swaps in its own client
 * island without touching the layout.
 */
const ENGINEERING_CONFIG: SolutionsPageConfig = {
  module: 'Engineering',
  path: '/solutions/engineering',
  hero: {
    heading: 'Automate code review, on-call, and docs with Sim agents.',
    description:
      'Engineering teams build AI agents in Sim, the open-source AI workspace, wired into GitHub, CI/CD, and 1,000+ integrations, visually, conversationally, or with code.',
    summary:
      'Sim is the open-source AI workspace where engineering teams build, deploy, and manage AI agents across the software lifecycle, automating code review, on-call triage, and documentation, wired into GitHub, CI/CD, and 1,000+ integrations.',
    visual: null,
  },
  rows: [
    {
      id: 'build',
      title: 'Automate the busywork.',
      subtitle: 'Sim agents take the repetitive engineering work off your plate.',
      cta: { label: 'See engineering agents', href: '/signup' },
      cards: [
        {
          title: 'Review pull requests',
          description:
            'Sim agents review diffs, flag risks, and leave inline comments before a human looks.',
          visual: null,
        },
        {
          title: 'Triage on-call',
          description:
            'Sim reads alerts, gathers context, and proposes a fix so on-call starts ahead.',
          visual: null,
        },
        {
          title: 'Generate docs',
          description: 'Sim keeps READMEs and runbooks in sync with the code as it changes.',
          visual: null,
        },
      ],
    },
    {
      id: 'connect',
      title: 'Wire into your tools.',
      subtitle: 'Sim connects the systems engineering already runs on.',
      cta: { label: 'Browse integrations', href: '/signup' },
      cards: [
        {
          title: 'GitHub and GitLab',
          description: 'Sim agents act on issues, PRs, and releases across your repositories.',
          visual: null,
        },
        {
          title: 'CI/CD pipelines',
          description:
            'Sim triggers on builds and deploys, so agents react the moment something ships.',
          visual: null,
        },
        {
          title: 'Observability',
          description:
            'Sim pulls from your logs and traces to give agents real production context.',
          visual: null,
        },
      ],
    },
  ],
}

export default function EngineeringSolution() {
  return <SolutionsPage config={ENGINEERING_CONFIG} />
}
