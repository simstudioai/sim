import { buildLandingMetadata } from '@/lib/landing/seo'
import Tables from '@/app/(landing)/tables/tables'

export const revalidate = 3600

const TITLE = 'Tables | Structured Data for Agents in Sim, the AI Workspace'
const DESCRIPTION =
  'Tables is the database built into Sim, the open-source AI workspace. Store, query, and wire structured data into agent runs — records, enrichments, and state between runs.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/tables',
  keywords:
    'AI workspace, built-in database, structured data for AI agents, AI agent memory, data enrichment, agent state between runs, open-source AI agent platform, tables for agents',
})

export default function Page() {
  return <Tables />
}
