import { buildLandingMetadata } from '@/lib/landing/seo'
import Logs from '@/app/(landing)/logs/logs'

export const revalidate = 3600

const TITLE = 'Logs | Trace Every Agent Run in Sim, the AI Workspace'
const DESCRIPTION =
  'Logs is the visibility layer in Sim, the open-source AI workspace. Trace every agent run block by block, filter and search across runs, and catch failures with alerts.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/logs',
  keywords:
    'AI workspace, AI agent logs, agent observability, trace agent runs, LLM run logs, AI agent monitoring, workflow run history, open-source AI agent platform',
})

export default function Page() {
  return <Logs />
}
