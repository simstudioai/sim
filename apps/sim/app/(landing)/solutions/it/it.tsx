import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AccessControlGraphic,
  AuditTrailGraphic,
  ItPlatformTeamsGraphic,
  OperationsTeamsGraphic,
  RunMonitoringGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { KnowledgeAnswerGraphic } from '@/app/(landing)/solutions/components/feature-graphics'
import { ItHeroLoop } from '@/app/(landing)/solutions/it/components/it-hero-loop'

/**
 * IT solution page - a consumer of {@link SolutionsPage} rendered with the
 * enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries an
 * enterprise feature graphic - reused directly where its story fits the
 * card (the access-control role graph, the audit ledger) or retold through
 * the graphics' content props for IT's use cases (ticket routing, incident
 * runbooks, infrastructure monitors) - so the page shares the enterprise
 * design language without any new visual vocabulary.
 */
/** Meta description shared between the page metadata and the page JSON-LD. */
export const IT_PAGE_DESCRIPTION =
  'AI agents for IT teams: automate ticket triage, access provisioning, and infrastructure monitoring. Built in Sim, the open-source AI workspace.'

const IT_CONFIG: SolutionsPageConfig = {
  module: 'IT',
  path: '/solutions/it',
  seoDescription: IT_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'IT',
    heading: 'Automate ticket triage, access, and monitoring with AI agents in Sim.',
    description:
      'Sim is the open-source AI workspace where IT teams build AI agents for ticket triage, access, and monitoring. Agents run with governance, access controls, and audit trails across 1,000+ integrations.',
    summary:
      'Sim is the open-source AI workspace where IT teams build, deploy, and manage AI agents for ticket triage, access provisioning, and infrastructure monitoring. Agents run with IT-grade governance and audit trails across 1,000+ integrations and every major LLM.',
    visual: (
      <PlatformHeroVisual>
        <ItHeroLoop />
      </PlatformHeroVisual>
    ),
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
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Gmail', 'Zendesk', 'Slack']}
              destinationLabels={['Jira', 'ServiceNow', 'Linear']}
            />
          ),
        },
        {
          title: 'Provision access',
          description:
            'Sim grants and revokes access by policy, so requests are handled in seconds, not days.',
          visual: <AccessControlGraphic />,
        },
        {
          title: 'Answer common questions',
          description: 'Sim deploys an internal help-desk agent that answers from your own docs.',
          visual: <KnowledgeAnswerGraphic />,
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
          visual: (
            <RunMonitoringGraphic
              fields={[
                { label: 'Workflow', value: 'Infra monitor', variant: 'strong' },
                { label: 'Run ID', value: '9b3fe127', variant: 'chip' },
                { label: 'Trigger', value: 'Alert', variant: 'chip' },
                { label: 'Duration', value: '0.82s', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'status', value: '"healthy"' },
                { key: 'checks', value: '42' },
              ]}
            />
          ),
        },
        {
          title: 'Respond to incidents',
          description:
            'Sim runs your runbooks automatically and escalates to the right on-call engineer.',
          visual: (
            <ItPlatformTeamsGraphic
              title='Incident'
              badgeLabel='Runbook'
              cardTitle='API latency · Sev 2'
              cardSubtitle='Runbook running now'
              cardTag='Active'
              controls={[
                { label: 'Service restarted', detail: 'Done' },
                { label: 'On-call paged', detail: 'Sent' },
                { label: 'Status page updated', detail: 'Done' },
              ]}
            />
          ),
        },
        {
          title: 'Audit every action',
          description:
            'Sim logs every agent run block by block, so IT can prove exactly what happened.',
          visual: <AuditTrailGraphic />,
        },
      ],
    },
  ],
}

export default function ItSolution() {
  return <SolutionsPage config={IT_CONFIG} />
}
