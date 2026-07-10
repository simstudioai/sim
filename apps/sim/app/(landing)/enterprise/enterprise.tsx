import { cn } from '@sim/emcn'
import Image from 'next/image'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  SolutionsHero,
  SolutionsLogosRow,
  SolutionsStructuredData,
} from '@/app/(landing)/components/solutions-page/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsPageConfig } from '@/app/(landing)/components/solutions-page/types'
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
 * Structurally it mirrors {@link SolutionsPage} (hero → logos → card rows) but
 * composes its own `<main>` so it can append the shared homepage CTA that
 * `SolutionsPage` does not render. The four feature rows render through
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
const ENTERPRISE_CONFIG: SolutionsPageConfig = {
  module: 'Enterprise',
  path: '/enterprise',
  hero: {
    heading: 'The AI Agent Platform for Enterprise Teams',
    description: 'Build, deploy, and govern enterprise AI agents in one workspace.',
    summary:
      'Sim is the open-source enterprise AI agent platform where IT, operations, and technical teams build, deploy, and govern enterprise AI agents in one AI workspace. Connect 1,000+ integrations and every major LLM, with security, role-based access, approvals, observability, versioning, and audit trails for reliable deployment across teams.',
    /**
     * The enterprise architectural backdrop with the enterprise-specific
     * platform loop framed in front of it: the same white demo window the
     * homepage hero uses, filled by the {@link EnterprisePlatformLoop} - a
     * sibling of the homepage `HeroPlatformLoop` that renders the whole
     * interior live (Brightwave sidebar + the real new-chat home view) and
     * replays an enterprise prompt. The `variant='home'` hero renders this
     * into the same `aspect-[1300/720]` media frame the homepage uses.
     */
    visual: (
      <>
        <Image
          fill
          priority
          alt=''
          className='object-cover object-center'
          sizes='(max-width: 1024px) 100vw, 1300px'
          src='/landing/enterprise-hero-background.webp'
        />
        <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex aspect-[1080/620] w-[83.08%] flex-col overflow-hidden rounded-[10px] bg-[var(--surface-1)] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_6px_0_rgba(0,0,0,0.05),0_4px_42px_0_rgba(0,0,0,0.06)]'>
          <div className='relative flex-1'>
            <EnterprisePlatformLoop />
          </div>
        </div>
      </>
    ),
  },
  rows: [
    {
      id: 'build',
      title: 'Build, Deploy, and Manage Enterprise AI Agents in One Workspace',
      subtitle:
        'Build enterprise AI agents, ship to production, and manage every version from one workspace.',
      cta: { label: 'Start building', href: '/signup' },
      cards: [
        {
          title: 'Build visually or with code',
          description: 'Create agents in the visual builder, through chat, or directly in code.',
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
          description: 'Version, monitor, and edit every agent as your workflows evolve.',
          visual: <LifecycleGraphic />,
        },
      ],
    },
    {
      id: 'governance',
      title: 'Governance and Security for Enterprise AI Agents',
      subtitle:
        'Security, approvals, and controls keep enterprise AI agents trusted in production.',
      cta: { label: 'See security', href: '/demo' },
      cards: [
        {
          title: 'Control who can do what',
          description:
            'Set roles and approval paths so the right people build, review, and launch agents.',
          visual: <AccessControlGraphic />,
        },
        {
          title: 'Prove every action',
          description: 'Trace every run block by block with a complete audit trail.',
          visual: <AuditTrailGraphic />,
        },
        {
          title: 'Meet enterprise standards',
          description:
            'SOC2 compliance and open source give security teams a clear path to review.',
          visual: <StandardsGraphic />,
          featureTileTone: 'dark',
          featureTileDescriptionTone: 'soft',
        },
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy Enterprise Workflow Agents with Confidence',
      subtitle: 'Stage, observe, and version workflow agents before they reach production.',
      cta: { label: 'Explore deployment', href: '/signup' },
      cards: [
        {
          title: 'Stage before you ship',
          description: 'Test changes in staging before they affect live workflows.',
          visual: <StagingGraphic />,
        },
        {
          title: 'Watch every run',
          description: 'See live logs, run history, and monitoring in one place.',
          visual: <RunMonitoringGraphic />,
        },
        {
          title: 'Roll back safely',
          description: 'Version workflows and roll back production agents in seconds.',
          visual: <RollbackGraphic />,
        },
      ],
    },
    {
      id: 'teams',
      title: 'Built for Enterprise Teams',
      subtitle:
        'Built for the teams that own enterprise AI agents across IT, operations, and engineering.',
      cta: { label: 'Talk to sales', href: '/demo' },
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
          description: 'Let technical teams ship, review, and maintain agents together.',
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
