import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import {
  EnterpriseLimitsPreview,
  EnterpriseMembersPreview,
} from '@/app/(landing)/enterprise/components/enterprise-product-previews'
import { LogTracePreview } from '@/app/(landing)/logs/components/log-trace-preview'

/** Shared description for page metadata and structured data. */
export const ENTERPRISE_SEO_DESCRIPTION =
  'Build and govern enterprise AI agents in Sim. Manage team access, workspace permissions, and usage limits, with visibility into every run.'

const ENTERPRISE_CONFIG: SolutionsProductPageConfig = {
  module: 'Enterprise',
  path: '/enterprise',
  seoDescription: ENTERPRISE_SEO_DESCRIPTION,
  offersFreeTier: false,
  hero: {
    eyebrow: 'Enterprise',
    heading: 'One AI workspace. You’re in control.',
    description:
      'Build, deploy, and govern AI agents in Sim, with shared access controls, usage limits, and visibility into every run.',
    summary:
      'Sim is the open-source AI workspace where enterprise teams build, deploy, and manage AI agents. Manage organization members and workspace permissions, control usage, and inspect agent runs in one place. Teams can connect their business tools and knowledge while keeping access and operations visible across the organization.',
    visual: <ProductHeroPreview product='enterprise' />,
  },
  codeExample: {
    title: 'Inspect runs from your terminal.',
    description:
      'Use the Sim CLI to find failed executions and inspect a run’s trace within the workspaces you can access.',
    filename: 'operations.sh',
    commands: [
      'sim workspaces list',
      'sim logs list --level error',
      'sim logs get "$RUN_ID" --trace',
    ],
  },
  features: [
    {
      id: 'governance',
      label: 'Organization controls',
      title: 'Give teams access. Keep control.',
      description:
        'Manage members and workspace roles in Sim. Try searching the example team or changing a role.',
      visual: <EnterpriseMembersPreview />,
      cta: {
        label: 'Explore workspace permissions',
        href: 'https://docs.sim.ai/platform/permissions',
      },
    },
    {
      id: 'usage',
      label: 'Usage and allowances',
      title: 'Keep room to grow and limits in view.',
      description:
        'See your team’s seat allowance and set usage limits in Sim as more people build agents.',
      visual: <EnterpriseLimitsPreview />,
      cta: { label: 'Talk about your team', href: '/demo' },
    },
    {
      id: 'visibility',
      label: 'Run visibility',
      title: 'See what every agent did.',
      description:
        'Follow each run in Sim, from the tools an agent called to the output it returned.',
      visual: <LogTracePreview />,
      cta: { label: 'Explore Logs', href: '/logs' },
    },
  ],
}

export default function EnterprisePage() {
  return <SolutionsPage config={ENTERPRISE_CONFIG} />
}
