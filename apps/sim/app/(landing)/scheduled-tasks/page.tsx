import { buildLandingMetadata } from '@/lib/landing/seo'
import ScheduledTasks from '@/app/(landing)/scheduled-tasks/scheduled-tasks'

export const revalidate = 3600

const TITLE = 'Scheduled Tasks | Run Agents on a Cadence in Sim, the AI Workspace'
const DESCRIPTION =
  'Scheduled Tasks runs your AI agents on a cadence in Sim, the open-source AI workspace. Schedule any workflow from 15-minute intervals to monthly or custom cron, timezone-aware, with every run traced.'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: '/scheduled-tasks',
  keywords:
    'AI workspace, scheduled AI agents, cron AI workflows, recurring agent runs, AI task scheduler, schedule workflow automation, open-source AI agent platform, agentic workflows',
})

export default function Page() {
  return <ScheduledTasks />
}
