import { cn } from '@sim/emcn'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import { PlatformHeroVisual } from '@/app/(landing)/components/platform-hero-visual'
import {
  SolutionsHero,
  SolutionsLogosRow,
  SolutionsStructuredData,
} from '@/app/(landing)/components/solutions-page/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsPageConfig } from '@/app/(landing)/components/solutions-page/types'
import { DEMO_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'
import { EnterpriseFeatureGrid } from '@/app/(landing)/enterprise/components/enterprise-feature-grid'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import {
  AccessControlGraphic,
  AuditTrailGraphic,
  BuildMethodsGraphic,
  DeployGraphic,
  ItPlatformTeamsGraphic,
  LifecycleGraphic,
  OperationsTeamsGraphic,
  RollbackGraphic,
  RunMonitoringGraphic,
  StagingGraphic,
  StandardsGraphic,
  TechnicalTeamsGraphic,
} from '@/app/(landing)/enterprise/components/feature-graphics'

/**
 * Enterprise landing page (`/enterprise`) - the flagship surface for teams
 * evaluating Sim as their enterprise AI agent platform.
 *
 * Structurally it mirrors {@link SolutionsPage} (hero → logos → card rows →
 * shared homepage CTA) but composes its own `<main>` so the hero can render
 * full-bleed in its `home` variant. The four feature rows render through
 * {@link EnterpriseFeatureGrid} - one shared grid that regroups the 12 cards
 * into 4/4/2/2 in the two-column band so no section leaves an orphan cell.
 * The shared `SOLUTIONS_SPACING` constants own the enterprise content gutter
 * and inter-section rhythm, while the homepage {@link Cta} owns the closing
 * conversion band.
 *
 * The strict heading outline is H1 (hero) → H2 (each card row + the CTA) → H3
 * (each card), never skipped. Server Component; the interactive leaves live in
 * the shared landing components.
 */
/**
 * The enterprise page's canonical description - shared by `page.tsx` (the
 * `<meta name="description">` and OG/Twitter cards) and the JSON-LD
 * `WebPage.description` via {@link SolutionsPageConfig.seoDescription}.
 */
export const ENTERPRISE_SEO_DESCRIPTION =
  'Build and govern enterprise AI agents in Sim with SSO, approvals, audit trails, versioning, and 1,000+ integrations.'

const ENTERPRISE_CONFIG: SolutionsPageConfig = {
  module: 'Enterprise',
  path: '/enterprise',
  seoDescription: ENTERPRISE_SEO_DESCRIPTION,
  offersFreeTier: false,
  hero: {
    heading: 'Sim is the enterprise AI agent platform for governed workflows.',
    description:
      'Build, deploy, and govern enterprise AI agents in one AI workspace, with role-based access, approvals, and full audit trails.',
    summary:
      'An enterprise AI agent uses AI models, business data, and connected tools to complete multi-step work within the permissions, approval policies, and human oversight your organization defines. Sim is the open-source AI workspace where IT, operations, and technical teams build, deploy, and govern enterprise AI agents across 1,000+ integrations and every major LLM.',
    /**
     * The shared {@link PlatformHeroVisual} backdrop-plus-demo-window
     * composition, filled by the {@link EnterprisePlatformLoop} - a sibling of
     * the homepage `HeroPlatformLoop` that renders the whole interior live
     * (Brightwave sidebar + the real new-chat home view) and replays an
     * enterprise prompt. The `variant='home'` hero renders this into the same
     * `aspect-[1300/720]` media frame the homepage uses.
     */
    visual: (
      <PlatformHeroVisual>
        <EnterprisePlatformLoop />
      </PlatformHeroVisual>
    ),
  },
  rows: [
    {
      id: 'build',
      title: 'Build, Deploy, and Manage Enterprise AI Agents',
      subtitle:
        'Sim takes enterprise AI agents from initial design to production in one workspace. Build visually or with code, validate changes, deploy approved versions, and monitor every run without connecting separate development and operations tools.',
      cta: { label: 'Start building', href: SIGNUP_HREF },
      cards: [
        {
          title: 'Build visually or with code',
          description:
            "Create enterprise AI agents in Sim's visual builder, describe the workflow in plain English, or write custom logic directly in code.",
          visual: <BuildMethodsGraphic />,
        },
        {
          title: 'Deploy in one click',
          description:
            'Move agents from staging to production without managing separate infrastructure.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <DeployGraphic />,
        },
        {
          title: 'Manage the full lifecycle',
          description:
            'Version, monitor, and update every enterprise AI agent in Sim as your business requirements, integrations, and governance policies evolve.',
          visual: <LifecycleGraphic />,
        },
      ],
    },
    {
      id: 'governance',
      title: 'Governance and Security for Enterprise AI Agents',
      subtitle:
        'Control how enterprise AI agents access data, use tools, and take action. Sim provides SSO, permission groups, approval paths, configurable data retention, and append-only audit logs for every security-relevant change.',
      cta: { label: 'See security', href: DEMO_HREF },
      cards: [
        {
          title: 'Control who can do what',
          description:
            'Set roles and approval paths so the right people build, review, and launch agents.',
          visual: <AccessControlGraphic />,
        },
        {
          title: 'Prove every action',
          description: 'Sim traces every run block by block with a complete audit trail.',
          visual: <AuditTrailGraphic />,
        },
        {
          title: 'Meet enterprise standards',
          description:
            'Sim is SOC2 compliant and open source, giving security teams a clear path to review.',
          visual: <StandardsGraphic />,
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
        },
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy Enterprise Workflow Agents with Confidence',
      subtitle:
        'Enterprise workflow agents need controlled release processes. Test changes in staging, observe production runs, version every deployment, and restore a stable version if updates cause an issue.',
      note: 'Deploy Sim on your own infrastructure with Docker or Kubernetes when your organization requires greater control over its environment and data.',
      cta: { label: 'Explore deployment', href: SIGNUP_HREF },
      cards: [
        {
          title: 'Stage before you ship',
          description: 'Test changes in staging before they affect live workflows.',
          visual: <StagingGraphic />,
        },
        {
          title: 'Watch every run',
          description: 'Sim shows live logs, run history, and monitoring in one place.',
          visual: <RunMonitoringGraphic />,
        },
        {
          title: 'Roll back safely',
          description: 'Sim versions workflows so you can roll back production agents in seconds.',
          visual: <RollbackGraphic />,
        },
      ],
    },
    {
      id: 'teams',
      title: 'Built for Enterprise Teams',
      subtitle:
        'IT, operations, and engineering teams share one Sim workspace, each with the controls their role needs.',
      cta: { label: 'Talk to sales', href: DEMO_HREF },
      cards: [
        {
          title: 'IT and platform teams',
          description: 'Give IT the access controls, governance, and audit trails they need.',
          visual: <ItPlatformTeamsGraphic />,
        },
        {
          title: 'Operations teams',
          description: 'Automate real work across the tools operations teams already use.',
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
          visual: <OperationsTeamsGraphic />,
        },
        {
          title: 'Technical teams',
          description: 'Technical teams ship, review, and maintain agents together in Sim.',
          visual: <TechnicalTeamsGraphic />,
        },
      ],
    },
  ],
}

export default function EnterprisePage() {
  return (
    <>
      <SolutionsStructuredData config={ENTERPRISE_CONFIG} />
      <main
        id='main-content'
        className={cn('flex w-full flex-col', SOLUTIONS_SPACING.sectionRhythm)}
      >
        <SolutionsHero hero={ENTERPRISE_CONFIG.hero} variant='home' />

        <div
          className={cn(
            'flex flex-col',
            LANDING_CONTENT_WIDTH,
            LANDING_GUTTER,
            SOLUTIONS_SPACING.sectionRhythm
          )}
        >
          <SolutionsLogosRow />
          <EnterpriseFeatureGrid rows={ENTERPRISE_CONFIG.rows} />
        </div>

        <Cta />
      </main>
    </>
  )
}
