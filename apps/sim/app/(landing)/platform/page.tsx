import { buildLandingMetadata } from '@/lib/landing/seo'
import Platform, { PLATFORM_PAGE_DESCRIPTION } from '@/app/(landing)/platform/platform'

export const revalidate = 3600

export const metadata = buildLandingMetadata({
  title: 'AI Workspace for Teams | Platform Overview | Sim',
  description: PLATFORM_PAGE_DESCRIPTION,
  path: '/platform',
  keywords:
    'AI workspace, AI agents, enterprise AI, visual workflow builder, knowledge base, agent files, agent tables, execution logs, open-source AI workspace',
})

export default function Page() {
  return <Platform />
}
