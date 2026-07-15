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
import { SalesHeroLoop } from '@/app/(landing)/solutions/sales/components/sales-hero-loop'

/**
 * Sales solution page - a consumer of {@link SolutionsPage} rendered with
 * the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries a
 * feature graphic in the enterprise design language, retold through the
 * graphics' content props for sales' use cases - inbound lead routing
 * across systems, a research brief grounded in real account context,
 * outreach drafting, CRM stage updates, meeting prep, and the pipeline
 * digest.
 */
const SALES_CONFIG: SolutionsPageConfig = {
  module: 'Sales',
  path: '/solutions/sales',
  hero: {
    eyebrow: 'Sales',
    heading: 'Automate lead research, outreach, and CRM updates with Sim agents.',
    description:
      'Sales teams build AI agents in Sim, the open-source AI workspace, wired into Salesforce, HubSpot, and 1,000+ integrations, so reps spend their time selling, not updating records.',
    summary:
      'Sim is the open-source AI workspace where sales teams build, deploy, and manage AI agents that automate lead research, personalized outreach, and CRM updates, wired into Salesforce, HubSpot, and 1,000+ integrations so the pipeline stays current and reps spend their time selling.',
    visual: (
      <PlatformHeroVisual>
        <SalesHeroLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'pipeline',
      title: 'Fill the pipeline.',
      subtitle: 'Sim agents handle research, outreach, and follow-up around the clock.',
      cta: { label: 'See sales agents', href: '/signup' },
      cards: [
        {
          title: 'Route inbound leads',
          description: 'Sim scores, routes, and follows up on new leads the moment they arrive.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: (
            <OperationsTeamsGraphic
              sourceLabels={['Webflow', 'Gmail', 'Typeform']}
              destinationLabels={['Salesforce', 'HubSpot', 'Slack']}
            />
          ),
        },
        {
          title: 'Research every lead',
          description:
            'Sim researches the company, the news, and the stack, and writes the brief before you call.',
          visual: (
            <KnowledgeAnswerGraphic
              question='What should I know about Acme Co?'
              answer='Series B logistics platform, 240 employees. They just hired a VP of Operations and run HubSpot today.'
              sourceLabel='Lead brief'
            />
          ),
        },
        {
          title: 'Draft outreach',
          description:
            'Sim drafts personalized outbound from the research, in your voice, ready to send.',
          visual: (
            <DocumentDraftGraphic
              title='Outbound email'
              statusTag='Personalized'
              footerLabel='Ready for review'
              footerDetail='Just now'
            />
          ),
        },
      ],
    },
    {
      id: 'crm',
      title: 'Keep the CRM true.',
      subtitle: 'Sim keeps records current so the forecast is built on real data.',
      cta: { label: 'Explore CRM automation', href: '/signup' },
      cards: [
        {
          title: 'Update the CRM',
          description: 'Sim logs calls, sets next steps, and moves stages after every touchpoint.',
          visual: (
            <StagingGraphic
              title='Opportunity'
              headerTag='$48,000'
              changeTag='Acme Co'
              changeTitle='Renewal · Q3'
              attribution='Updated by Sim · 2m ago'
              checks={['Call notes logged', 'Next step set', 'Close date confirmed']}
              fromLabel='Proposal'
              toLabel='Negotiation'
              actionLabel='Update'
            />
          ),
        },
        {
          title: 'Prep every meeting',
          description: 'Sim assembles a brief before every call from your CRM, email, and notes.',
          visual: (
            <ItPlatformTeamsGraphic
              title='Meeting prep'
              badgeLabel='Daily'
              cardTitle='Acme Co · 2:00 PM'
              cardSubtitle='Brief sent to account owner'
              cardTag='Ready'
              controls={[
                { label: 'Recent activity pulled', detail: 'Done' },
                { label: 'Open deals summarized', detail: 'Done' },
                { label: 'Talking points drafted', detail: 'Done' },
              ]}
            />
          ),
        },
        {
          title: 'Report the pipeline',
          description: 'Sim assembles pipeline and forecast digests from your CRM on schedule.',
          visual: (
            <RunMonitoringGraphic
              title='Pipeline digest'
              fields={[
                { label: 'Report', value: 'Pipeline · Q3', variant: 'strong' },
                { label: 'Source', value: 'Salesforce', variant: 'chip' },
                { label: 'Trigger', value: 'Schedule', variant: 'chip' },
                { label: 'Duration', value: '2.41s', variant: 'mono' },
              ]}
              outputPairs={[
                { key: 'pipeline', value: '"$4.2M"' },
                { key: 'deals', value: '38' },
              ]}
            />
          ),
        },
      ],
    },
  ],
}

export default function SalesSolution() {
  return <SolutionsPage config={SALES_CONFIG} />
}
