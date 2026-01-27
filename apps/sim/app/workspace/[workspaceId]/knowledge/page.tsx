import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { getUserPermissionConfig } from '@/executor/utils/permission-check'
import { Knowledge } from './knowledge'

interface KnowledgePageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function KnowledgePage({ params }: KnowledgePageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  // Check permission group restrictions
  const permissionConfig = await getUserPermissionConfig(session.user.id)
  if (permissionConfig?.hideKnowledgeBaseTab) {
    redirect(`/workspace/${workspaceId}`)
  }

  return <Knowledge />
}
