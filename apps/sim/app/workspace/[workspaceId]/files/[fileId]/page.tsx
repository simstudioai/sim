import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { Files } from '../files'

export const metadata: Metadata = {
  title: 'Files',
  robots: { index: false },
}

interface FileDetailPageProps {
  params: Promise<{
    workspaceId: string
    fileId: string
  }>
}

export default async function FileDetailPage({ params }: FileDetailPageProps) {
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
  if (permissionConfig?.hideFilesTab) {
    redirect(`/workspace/${workspaceId}`)
  }

  return <Files />
}
