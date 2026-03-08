import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { Schedules } from './schedules'

interface SchedulesPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function SchedulesPage({ params }: SchedulesPageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  return <Schedules />
}
