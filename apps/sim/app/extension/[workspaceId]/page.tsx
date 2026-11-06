import { Suspense } from 'react'
import { ExtensionWorkspace } from '@/app/extension/[workspaceId]/workspace'
import ExtensionLoading from '@/app/extension/loading'

interface ExtensionWorkspacePageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function ExtensionWorkspacePage({ params }: ExtensionWorkspacePageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<ExtensionLoading />}>
      <ExtensionWorkspace key={workspaceId} workspaceId={workspaceId} />
    </Suspense>
  )
}
