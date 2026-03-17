import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { Knowledge } from './knowledge'

export const metadata: Metadata = {
  title: 'Knowledge Base',
}

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

  const permissionConfig = await getUserPermissionConfig(session.user.id)
  if (permissionConfig?.hideKnowledgeBaseTab) {
    redirect(`/workspace/${workspaceId}`)
  }

  return <Knowledge />
}
