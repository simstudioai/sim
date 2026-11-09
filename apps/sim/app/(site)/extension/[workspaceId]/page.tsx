import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/shell-organization'
import { ExtensionWorkspace } from '@/app/(site)/extension/[workspaceId]/workspace'
import ExtensionLoading from '@/app/(site)/extension/loading'

interface ExtensionWorkspacePageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function ExtensionWorkspacePage({ params }: ExtensionWorkspacePageProps) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  // Where "Open in Sim" lands: the organization this workspace's pages render in for the viewer.
  const organizationId = session?.user?.id
    ? await resolveWorkspaceShellOrganizationId(workspaceId, session.user.id)
    : null
  return (
    <Suspense fallback={<ExtensionLoading />}>
      <ExtensionWorkspace
        key={workspaceId}
        workspaceId={workspaceId}
        organizationId={organizationId}
      />
    </Suspense>
  )
}
