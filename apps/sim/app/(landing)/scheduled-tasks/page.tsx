import { buildLandingMetadata } from '@/lib/landing/seo'
import ScheduledTasks, {
  SCHEDULED_TASKS_PAGE_DESCRIPTION,
} from '@/app/(landing)/scheduled-tasks/scheduled-tasks'

export const revalidate = 3600

const TITLE = 'Schedule AI Agents: Cron & Recurring Runs | Sim'

export const metadata = buildLandingMetadata({
  title: TITLE,
  description: SCHEDULED_TASKS_PAGE_DESCRIPTION,
  path: '/scheduled-tasks',
  keywords:
    'AI workspace, scheduled AI agents, cron AI workflows, recurring agent runs, AI task scheduler, schedule workflow automation, open-source AI agent platform, agentic workflows',
})

export default function Page() {
  return <ScheduledTasks />
}
