import { buildLandingMetadata } from '@/lib/landing/seo'
import Workflows from '@/app/(landing)/workflows/workflows'

export const revalidate = 3600

const TITLE = 'Workflows | The Visual Builder in Sim, the AI Workspace'
const DESCRIPTION =
  'Workflows is the visual builder in Sim, the open-source AI workspace. Connect blocks, every major LLM, and 1,000+ integrations into agent logic.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/workflows',
  keywords:
    'AI workspace, visual workflow builder, build AI agents, AI agent workflow builder, LLM orchestration, AI integrations, open-source AI agent platform, agentic workflows',
})

export default function Page() {
  return <Workflows />
}
