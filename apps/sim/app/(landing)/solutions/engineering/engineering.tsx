import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  DeployGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
  StagingGraphic,
  TechnicalTeamsGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { DocumentDraftGraphic } from '@/app/(landing)/solutions/components/feature-graphics'
import { EngineeringHeroLoop } from '@/app/(landing)/solutions/engineering/components/engineering-hero-loop'

/**
 * Engineering solution page - a consumer of {@link SolutionsPage} rendered
 * with the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries an
 * enterprise feature graphic - reused directly where its story fits the
 * card (the code-review diff, the promotion window) or retold through the
 * graphics' content props for engineering's use cases (on-call routing,
 * CI/CD deploys, runbook docs) - so the page shares the enterprise design
 * language without any new visual vocabulary.
 */
const ENGINEERING_CONFIG: SolutionsPageConfig = {
  module: 'Engineering',
  path: '/solutions/engineering',
  hero: {
    eyebrow: 'Engineering',
    heading: 'Automate code review, on-call, and docs with Sim agents.',
    description:
      'Engineering teams build AI agents in Sim, the open-source AI workspace, wired into GitHub, CI/CD, and 1,000+ integrations, visually, conversationally, or with code.',
    summary:
      'Sim is the open-source AI workspace where engineering teams build, deploy, and manage AI agents across the software lifecycle, automating code review, on-call triage, and documentation, wired into GitHub, CI/CD, and 1,000+ integrations.',
    visual: (
      <PlatformHeroVisual>
        <EngineeringHeroLoop />
      </PlatformHeroVisual>
    ),
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
          visual: <TechnicalTeamsGraphic />,
        },
        {
          title: 'Triage on-call',
          description:
            'Sim reads alerts, gathers context, and proposes a fix so on-call starts ahead.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['PagerDuty', 'Datadog', 'Sentry']}
              destinationLabels={['Slack', 'Jira', 'GitHub']}
            />
          ),
        },
        {
          title: 'Generate docs',
          description: 'Sim keeps READMEs and runbooks in sync with the code as it changes.',
          visual: (
            <DocumentDraftGraphic
              title='runbook.md'
              statusTag='Synced'
              footerLabel='Updated from main'
              footerDetail='Just now'
            />
          ),
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
          visual: (
            <StagingGraphic
              title='Pull request'
              headerTag='#482'
              changeTag='b7e2f19'
              changeTitle='Add retry to webhook handler'
              attribution='Sim agent · 5m ago'
              checks={['CI checks passed', 'Review approved', 'No merge conflicts']}
              fromLabel='Feature'
              toLabel='Main'
              actionLabel='Merge'
            />
          ),
        },
        {
          title: 'CI/CD pipelines',
          description:
            'Sim triggers on builds and deploys, so agents react the moment something ships.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <DeployGraphic
              agentName='Deploy agent'
              versionTag='v12'
              url='sim.ai/agents/deploy'
              statusLabel='Build passed · live'
            />
          ),
        },
        {
          title: 'Observability',
          description:
            'Sim pulls from your logs and traces to give agents real production context.',
          visual: (
            <RunMonitoringGraphic
              fields={[
                { label: 'Workflow', value: 'On-call triage', variant: 'strong' },
                { label: 'Run ID', value: 'c4e81b2a', variant: 'chip' },
                { label: 'Trigger', value: 'Alert', variant: 'chip' },
                { label: 'Duration', value: '2.14s', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'severity', value: '"low"' },
                { key: 'resolved', value: 'true' },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function EngineeringSolution() {
  return <SolutionsPage config={ENGINEERING_CONFIG} cardVariant='featureTile' />
}
