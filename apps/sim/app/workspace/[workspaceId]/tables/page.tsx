import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { TablesView } from './components'

interface TablesPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function TablesPage({ params }: TablesPageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  const permissionConfig = await getUserPermissionConfig(session.user.id)
  if (permissionConfig?.hideTablesTab) {
    redirect(`/workspace/${workspaceId}`)
  }

  return <TablesView />
}
