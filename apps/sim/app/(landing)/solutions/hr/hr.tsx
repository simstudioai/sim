import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  ItPlatformTeamsGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
  StagingGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import {
  DocumentDraftGraphic,
  KnowledgeAnswerGraphic,
} from '@/app/(landing)/solutions/components/feature-graphics'
import { HrHeroLoop } from '@/app/(landing)/solutions/hr/components/hr-hero-loop'

/**
 * HR solution page - a consumer of {@link SolutionsPage} rendered with the
 * enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries a
 * feature graphic in the enterprise design language, retold through the
 * graphics' content props for HR's use cases - onboarding fan-out across
 * systems, a benefits answer grounded in the team's docs, offer-letter
 * drafting, PTO approvals, surveys, and people reports.
 */
/** Meta description shared between the page metadata and the page JSON-LD. */
export const HR_PAGE_DESCRIPTION =
  'AI agents for HR teams: automate onboarding, employee questions, and approvals. Built in Sim, the open-source AI workspace.'

const HR_CONFIG: SolutionsPageConfig = {
  module: 'HR',
  path: '/solutions/hr',
  seoDescription: HR_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'HR',
    heading: 'Automate onboarding, employee questions, and approvals with AI agents in Sim.',
    description:
      'Sim is the open-source AI workspace where HR teams build AI agents for onboarding, employee questions, and approvals. Agents wire into your HRIS and 1,000+ integrations to keep people operations moving.',
    summary:
      'Sim is the open-source AI workspace where HR teams build, deploy, and manage AI agents for onboarding, employee questions, and approvals. Agents connect your HRIS and 1,000+ integrations so people operations keep moving.',
    visual: (
      <PlatformHeroVisual>
        <HrHeroLoop />
      </PlatformHeroVisual>
    ),
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
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Greenhouse', 'Workday', 'Gmail']}
              destinationLabels={['Okta', 'Slack', 'Calendar']}
            />
          ),
        },
        {
          title: 'Answer HR questions',
          description:
            'Sim deploys an agent that answers policy and benefits questions from your docs.',
          visual: (
            <KnowledgeAnswerGraphic
              question='How much parental leave do we get?'
              answer='Sixteen weeks fully paid, plus four flexible weeks in the first year. Your manager approves the schedule.'
              sourceLabel='Benefits policy'
            />
          ),
        },
        {
          title: 'Generate documents',
          description:
            'Sim drafts offer letters and policy docs from your templates automatically.',
          visual: (
            <DocumentDraftGraphic
              title='Offer letter'
              statusTag='From template'
              footerLabel='Ready for signature'
              footerDetail='Just now'
            />
          ),
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
          visual: (
            <StagingGraphic
              title='PTO request'
              headerTag='5 days'
              changeTag='Aug 4–8'
              changeTitle='Vacation · Maya Chen'
              attribution='Routed to manager · 1m ago'
              checks={['Balance available', 'No team conflicts', 'Policy met']}
              fromLabel='Requested'
              toLabel='Approved'
              actionLabel='Approve'
            />
          ),
        },
        {
          title: 'Run surveys',
          description: 'Sim collects and summarizes engagement feedback so trends surface early.',
          visual: (
            <ItPlatformTeamsGraphic
              title='Surveys'
              badgeLabel='Quarterly'
              cardTitle='Q3 engagement pulse'
              cardSubtitle='318 of 412 responses in'
              cardTag='Live'
              controls={[
                { label: 'Sent to every team', detail: 'Done' },
                { label: 'Reminders scheduled', detail: 'Aug 12' },
                { label: 'Themes summarized', detail: 'Weekly' },
              ]}
            />
          ),
        },
        {
          title: 'Build reports',
          description: 'Sim assembles headcount and people reports from your HRIS on schedule.',
          visual: (
            <RunMonitoringGraphic
              title='People report'
              fields={[
                { label: 'Report', value: 'Headcount · Q3', variant: 'strong' },
                { label: 'Source', value: 'HRIS', variant: 'chip' },
                { label: 'Trigger', value: 'Schedule', variant: 'chip' },
                { label: 'Duration', value: '3.02s', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'headcount', value: '412' },
                { key: 'open_roles', value: '23' },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function HrSolution() {
  return <SolutionsPage config={HR_CONFIG} />
}
