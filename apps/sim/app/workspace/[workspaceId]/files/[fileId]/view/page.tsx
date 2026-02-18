import { redirect, unstable_rethrow } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/[fileId]/view/file-viewer'

interface FileViewerPageProps {
  params: Promise<{
    workspaceId: string
    fileId: string
  }>
}

export default async function FileViewerPage({ params }: FileViewerPageProps) {
  const { workspaceId, fileId } = await params

  const session = await getSession()
  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect(`/workspace/${workspaceId}`)
  }

  let fileRecord: Awaited<ReturnType<typeof getWorkspaceFile>>
  try {
    fileRecord = await getWorkspaceFile(workspaceId, fileId)
  } catch (error) {
    unstable_rethrow(error)
    redirect(`/workspace/${workspaceId}`)
  }

  if (!fileRecord) {
    redirect(`/workspace/${workspaceId}`)
  }

  return <FileViewer file={fileRecord} />
}
