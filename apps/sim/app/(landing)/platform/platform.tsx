import {
  SolutionsPage,
  type SolutionsProductPageConfig,
} from '@/app/(landing)/components/solutions-page'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'
import { PlatformExplorer } from '@/app/(landing)/platform/components/platform-explorer'
import { PlatformFeaturePreview } from '@/app/(landing)/platform/components/platform-feature-preview'

/** Shared description for page metadata and structured data. */
export const PLATFORM_PAGE_DESCRIPTION =
  'Build, deploy, and manage AI agents in Sim. Workflows, Knowledge Base, Files, Tables, and Logs share one AI workspace with controls for your team.'

const PLATFORM_CONFIG: SolutionsProductPageConfig = {
  module: 'Platform',
  path: '/platform',
  seoDescription: PLATFORM_PAGE_DESCRIPTION,
  hero: {
    eyebrow: 'Platform',
    heading: 'One AI workspace for every agent.',
    description:
      'Build AI agents, connect company knowledge, and follow every run. All together in Sim.',
    summary:
      'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents. Workflows connects models and tools, Knowledge Base supplies source context, Files and Tables hold shared data, and Logs shows each execution. Enterprise adds controls for team access, usage, and deployment.',
    visual: <ProductHeroPreview product='overview' />,
  },
  features: [
    {
      id: 'explore',
      label: 'Explore the workspace',
      title: 'Build, run, and govern. Together.',
      description:
        'Explore Workflows, Knowledge Base, Files, Tables, Logs, and Enterprise in one connected workspace.',
      visual: <PlatformExplorer />,
    },
    {
      id: 'shared-context',
      label: 'Shared context',
      title: 'Your company knowledge, connected.',
      description:
        'Give agents a shared source of context in Sim. Connect documents, retrieve passages, and keep the source in view.',
      visual: <PlatformFeaturePreview product='knowledge' />,
      cta: { label: 'Explore Knowledge Base', href: '/knowledge' },
    },
    {
      id: 'governance',
      label: 'Workspace governance',
      title: 'Room to build. Controls to scale.',
      description:
        'Manage members, roles, and usage in Sim as more teams bring agents into their work.',
      visual: <PlatformFeaturePreview product='enterprise' />,
      cta: { label: 'Explore Enterprise', href: '/enterprise' },
    },
  ],
}

export default function Platform() {
  return <SolutionsPage config={PLATFORM_CONFIG} />
}
