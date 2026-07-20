import { buildLandingMetadata } from '@/lib/landing/seo'
import Logs, { LOGS_PAGE_DESCRIPTION } from '@/app/(landing)/logs/logs'

export const revalidate = 3600

const TITLE = 'AI Agent Observability & Logs: Trace Every Run | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: LOGS_PAGE_DESCRIPTION,
  path: '/logs',
  keywords:
    'AI agent observability, AI workspace, AI agent logs, trace agent runs, LLM run logs, AI agent monitoring, workflow run history, open-source AI agent platform',
})

export default function Page() {
  return <Logs />
}
