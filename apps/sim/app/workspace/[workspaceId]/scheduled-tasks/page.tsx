import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { ScheduledTasks } from './scheduled-tasks'

export const metadata: Metadata = {
  title: 'Scheduled Tasks',
}

interface ScheduledTasksPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function ScheduledTasksPage({ params }: ScheduledTasksPageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  return <ScheduledTasks />
}
