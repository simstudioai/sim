import {
  PlatformHeroVisual,
  SolutionsPage,
  type SolutionsPageConfig,
} from '@/app/(landing)/components'
import {
  AccessControlGraphic,
  AuditTrailGraphic,
  ItPlatformTeamsGraphic,
  StandardsGraphic,
  TechnicalTeamsGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'
import { ComplianceHeroLoop } from '@/app/(landing)/solutions/compliance/components/compliance-hero-loop'
import { DocumentDraftGraphic } from '@/app/(landing)/solutions/components/feature-graphics'

/**
 * Compliance solution page - a consumer of {@link SolutionsPage} rendered
 * with the enterprise page's feature-tile treatment.
 *
 * The whole page is one typed {@link SolutionsPageConfig} rendered inside
 * the shared route-group layout's chrome. Every visual slot carries an
 * enterprise feature graphic - reused directly where its story fits the
 * card (the audit ledger, the access role graph) or retold through the
 * graphics' content props for compliance's use cases (evidence schedules,
 * framework monitoring, policy review) - so the page shares the enterprise
 * design language without any new visual vocabulary.
 */
const COMPLIANCE_CONFIG: SolutionsPageConfig = {
  module: 'Compliance',
  path: '/solutions/compliance',
  hero: {
    eyebrow: 'Compliance',
    heading: 'Automate evidence, control checks, and audit reports with Sim agents.',
    description:
      'Compliance teams build AI agents in Sim, the open-source AI workspace, that monitor controls and assemble a clean, defensible record, keeping the organization continuously audit-ready instead of scrambling once a year.',
    summary:
      'Sim is the open-source AI workspace where compliance teams build, deploy, and manage AI agents that automate evidence collection, control monitoring, and reporting, keeping the organization continuously audit-ready across 1,000+ integrations.',
    visual: (
      <PlatformHeroVisual>
        <ComplianceHeroLoop />
      </PlatformHeroVisual>
    ),
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
          visual: (
            <ItPlatformTeamsGraphic
              title='Evidence'
              badgeLabel='On schedule'
              cardTitle='SOC 2 · Q3 collection'
              cardSubtitle='Runs weekly across systems'
              cardTag='Running'
              controls={[
                { label: 'Access logs exported', detail: 'Done' },
                { label: 'Configs snapshotted', detail: 'Done' },
                { label: 'Screenshots captured', detail: 'Queued' },
              ]}
            />
          ),
        },
        {
          title: 'Monitor controls',
          description: 'Sim continuously checks controls and flags drift the moment it appears.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <StandardsGraphic rightLabel='ISO 27001' sealLabel='Monitored' />,
        },
        {
          title: 'Check policies',
          description:
            'Sim reviews changes against your policies and raises anything out of bounds.',
          visual: (
            <TechnicalTeamsGraphic
              diffLines={[
                { marker: ' ', code: "policy: 'data-retention'," },
                { marker: ' ', code: "scope: 'production'," },
                { marker: ' ', code: 'rules: [' },
                { marker: ' ', code: "  encrypt: 'at-rest'," },
                { marker: '-', code: '  retainDays: 30,' },
                { marker: '+', code: '  retainDays: 90,' },
                { marker: ' ', code: ']' },
              ]}
              reviewerName='Jordan Lee'
              reviewerAction='Requested policy review'
              verdictTag='Flagged'
              footerLabel='Policy checks passed'
              footerDetail='11 of 12'
            />
          ),
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
          visual: <AccessControlGraphic />,
        },
        {
          title: 'Generate reports',
          description:
            'Sim assembles audit-ready reports from live evidence, not stale spreadsheets.',
          visual: (
            <DocumentDraftGraphic
              title='SOC 2 report'
              statusTag='Audit-ready'
              footerLabel='Built from live evidence'
              footerDetail='Today'
            />
          ),
        },
        {
          title: 'Trace every action',
          description: 'Sim logs every run block by block, so auditors see exactly what happened.',
          visual: <AuditTrailGraphic />,
        },
      ],
    },
  ],
}

export default function ComplianceSolution() {
  return <SolutionsPage config={COMPLIANCE_CONFIG} />
}
