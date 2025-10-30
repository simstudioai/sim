import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { FileViewer } from './file-viewer'

interface FileViewerPageProps {
  params: Promise<{
    workspaceId: string
    fileId: string
  }>
}

export default async function FileViewerPage({ params }: FileViewerPageProps) {
  const { workspaceId, fileId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      redirect('/')
    }

    const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!hasPermission) {
      redirect(`/workspace/${workspaceId}`)
    }

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      redirect(`/workspace/${workspaceId}`)
    }

    return <FileViewer file={fileRecord} />
  } catch (error) {
    redirect(`/workspace/${workspaceId}`)
  }
}
