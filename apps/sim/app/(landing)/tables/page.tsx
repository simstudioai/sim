import { buildLandingMetadata } from '@/lib/landing/seo'
import Tables, { TABLES_PAGE_DESCRIPTION } from '@/app/(landing)/tables/tables'

export const revalidate = 3600

const TITLE = 'AI Agent Database: Tables for Structured Data | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: TABLES_PAGE_DESCRIPTION,
  path: '/tables',
  keywords:
    'AI agent database, AI workspace, built-in database, structured data for AI agents, AI agent memory, data enrichment, agent state between runs, open-source AI agent platform, tables for agents',
})

export default function Page() {
  return <Tables />
}
