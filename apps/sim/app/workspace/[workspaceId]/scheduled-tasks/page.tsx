import { Suspense } from 'react'
import type { Metadata } from 'next'
import ScheduledTasksLoading from '@/app/workspace/[workspaceId]/scheduled-tasks/loading'
import { ScheduledTasks } from './scheduled-tasks'

export const metadata: Metadata = {
  title: 'Scheduled Tasks',
}

/**
 * Scheduled-tasks page entry. `ScheduledTasks` reads the calendar's `scope` /
 * `anchor` URL query params via nuqs (which uses `useSearchParams` internally),
 * so it must sit under a Suspense boundary. The fallback renders the real chrome
 * so a suspend never shows a blank frame.
 */
export default function ScheduledTasksPage() {
  return (
    <Suspense fallback={<ScheduledTasksLoading />}>
      <ScheduledTasks />
    </Suspense>
  )
}
