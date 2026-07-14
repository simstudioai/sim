import { buildLandingMetadata } from '@/lib/landing/seo'
import Knowledge from '@/app/(landing)/knowledge/knowledge'

export const revalidate = 3600

const TITLE = 'Knowledge Base | Agent Memory in Sim, the AI Workspace'
const DESCRIPTION =
  "Knowledge Base is your agents' memory in Sim, the open-source AI workspace. Upload docs, sync sources like Notion and Google Drive, and get answers grounded in your own data, with citations."

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/knowledge',
  keywords:
    'AI workspace, knowledge base for AI agents, agent memory, ground AI answers in company data, sync documents to AI agents, AI answers with citations, open-source AI workspace',
})

export default function Page() {
  return <Knowledge />
}
