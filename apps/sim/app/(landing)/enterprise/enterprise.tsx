import { ChipLink, cn } from '@sim/emcn'
import {
  SolutionsCardRow,
  SolutionsHero,
  SolutionsLogosRow,
  SolutionsStructuredData,
} from '@/app/(landing)/components/solutions-page/components'
import { SOLUTIONS_SPACING } from '@/app/(landing)/components/solutions-page/constants'
import type { SolutionsPageConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * Enterprise landing page (`/enterprise`) - the flagship surface for teams
 * evaluating Sim as their enterprise AI agent platform.
 *
 * Structurally it mirrors {@link SolutionsPage} (hero → logos → card rows) but
 * composes its own `<main>` so it can append a trailing CTA band that
 * `SolutionsPage` does not render. The shared `SOLUTIONS_SPACING` constants own
 * the gutter and inter-section rhythm, and the shared solutions components own
 * the hero, logos, and card-row chrome - so this file is pure content plus the
 * closing CTA.
 *
 * The strict heading outline is H1 (hero) → H2 (each card row + the CTA) → H3
 * (each card), never skipped. Server Component; the only interactive leaves are
 * the shared `HeroCta` (inside `SolutionsHero`) and the CTA's `ChipLink`s.
 */
const ENTERPRISE_CONFIG: SolutionsPageConfig = {
  module: 'Enterprise',
  path: '/enterprise',
  hero: {
    heading: 'The Enterprise AI Agent Platform for Teams',
    description:
      'Sim is the enterprise AI workspace where teams build, deploy, and govern AI agents. Connect 1,000+ integrations and every major LLM to run agents that automate real work, with security, approvals, and audit trails built into the enterprise AI agent platform.',
    summary:
      'Sim is the open-source enterprise AI agent platform where IT, operations, and technical teams build, deploy, and govern enterprise AI agents in one AI workspace. Connect 1,000+ integrations and every major LLM, with security, role-based access, approvals, observability, versioning, and audit trails for reliable deployment across teams.',
    visual: null,
  },
  rows: [
    {
      id: 'build',
      title: 'Build, Deploy, and Manage Enterprise AI Agents in One Workspace',
      subtitle:
        'Sim gives teams one workspace to build enterprise AI agents, ship them to production, and manage every enterprise AI agent across its lifecycle.',
      cta: { label: 'Start building', href: '/signup' },
      cards: [
        {
          title: 'Build visually or with code',
          description:
            'Sim lets teams build enterprise AI agents in a visual workflow builder, in natural language with Mothership, or with code.',
          visual: null,
        },
        {
          title: 'Deploy in one click',
          description:
            'Sim deploys an enterprise AI agent to staging or production from the same workspace, with no separate infrastructure to manage.',
          visual: null,
        },
        {
          title: 'Manage the full lifecycle',
          description:
            'Sim keeps every enterprise AI agent versioned, monitored, and editable, so teams manage changes without rebuilding from scratch.',
          visual: null,
        },
      ],
    },
    {
      id: 'governance',
      title: 'Governance and Security for Enterprise AI Agents',
      subtitle:
        'Sim is the enterprise AI agent platform built for security and control, so teams can trust every enterprise AI agent they run in production.',
      cta: { label: 'See security', href: '/demo' },
      cards: [
        {
          title: 'Control who can do what',
          description:
            'Sim gives administrators role-based access and approvals, so the right people build enterprise AI agents and the right people sign off before they go live.',
          visual: null,
        },
        {
          title: 'Prove every action',
          description:
            'Sim logs each agent run block by block, giving teams a complete audit trail of what every enterprise AI agent did and why.',
          visual: null,
        },
        {
          title: 'Meet enterprise standards',
          description:
            'Sim is SOC2 compliant and open source, so security teams can review how the enterprise AI agent platform works before they adopt it.',
          visual: null,
        },
      ],
    },
    {
      id: 'deploy',
      title: 'Deploy Enterprise Workflow Agents with Confidence',
      subtitle:
        'Sim ships enterprise workflow agents from staging to production with the observability and versioning teams need to deploy reliably across the organization.',
      cta: { label: 'Explore deployment', href: '/signup' },
      cards: [
        {
          title: 'Stage before you ship',
          description:
            'Sim runs enterprise workflow agents in staging first, so teams test changes safely before they reach production.',
          visual: null,
        },
        {
          title: 'Watch every run',
          description:
            'Sim gives teams full observability across live logs, run history, and monitoring for every enterprise workflow agent in production.',
          visual: null,
        },
        {
          title: 'Roll back safely',
          description:
            'Sim versions every workflow, so teams deploy with confidence and revert any enterprise workflow agent in seconds.',
          visual: null,
        },
      ],
    },
    {
      id: 'teams',
      title: 'Built for Enterprise Teams',
      subtitle:
        'Sim is built for the teams that run enterprise AI agents, and the governance, lifecycle management, and collaboration an enterprise AI agent demands.',
      cta: { label: 'Talk to sales', href: '/demo' },
      cards: [
        {
          title: 'IT and platform teams',
          description:
            'IT teams use Sim to build enterprise AI agents with the access controls, governance, and audit trails their organization requires.',
          visual: null,
        },
        {
          title: 'Operations teams',
          description:
            'Operations teams use Sim to deploy enterprise AI agents that automate real work across the tools they already run.',
          visual: null,
        },
        {
          title: 'Technical teams',
          description:
            'Engineering and technical teams collaborate in Sim to ship, review, and maintain every enterprise AI agent together.',
          visual: null,
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
        className={cn(
          'mx-auto flex w-full max-w-[1460px] flex-col',
          SOLUTIONS_SPACING.sectionRhythm,
          SOLUTIONS_SPACING.gutter
        )}
      >
        <SolutionsHero hero={ENTERPRISE_CONFIG.hero} />
        <SolutionsLogosRow />
        {ENTERPRISE_CONFIG.rows.map((row) => (
          <SolutionsCardRow key={row.id} row={row} />
        ))}

        <section
          id='enterprise-cta'
          aria-labelledby='enterprise-cta-heading'
          className='flex flex-col items-center gap-[22px] text-center'
        >
          <h2
            id='enterprise-cta-heading'
            className='max-w-[860px] text-balance text-[48px] text-[var(--text-primary)] leading-[1.1] max-sm:text-[32px] max-xl:text-[40px]'
          >
            Build enterprise AI agents in Sim
          </h2>
          <div className='flex items-center gap-3'>
            <ChipLink variant='primary' href='/signup'>
              Get started
            </ChipLink>
            <ChipLink href='/demo' className='border border-[var(--border-1)]'>
              Contact sales
            </ChipLink>
          </div>
        </section>
      </main>
    </>
  )
}
