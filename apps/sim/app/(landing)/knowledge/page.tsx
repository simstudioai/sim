import { buildLandingMetadata } from '@/lib/landing/seo'
import Knowledge, { KNOWLEDGE_PAGE_DESCRIPTION } from '@/app/(landing)/knowledge/knowledge'

export const revalidate = 3600

const TITLE = 'Knowledge Base for AI Agents: Memory & Citations | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: KNOWLEDGE_PAGE_DESCRIPTION,
  path: '/knowledge',
  keywords:
    'AI workspace, knowledge base for AI agents, agent memory, ground AI answers in company data, sync documents to AI agents, AI answers with citations, open-source AI workspace',
})

export default function Page() {
  return <Knowledge />
}
