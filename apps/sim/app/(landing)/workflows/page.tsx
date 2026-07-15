import { buildLandingMetadata } from '@/lib/landing/seo'
import Workflows, { WORKFLOWS_PAGE_DESCRIPTION } from '@/app/(landing)/workflows/workflows'

export const revalidate = 3600

const TITLE = 'AI Workflow Builder for Agents and Teams | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: WORKFLOWS_PAGE_DESCRIPTION,
  path: '/workflows',
  keywords:
    'AI workflow builder, AI workspace, visual workflow builder, build AI agents, AI agent workflow builder, LLM orchestration, AI integrations, open-source AI agent platform, agentic workflows',
})

export default function Page() {
  return <Workflows />
}
