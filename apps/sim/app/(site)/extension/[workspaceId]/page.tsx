import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { resolveOrProvisionLandingOrganization } from '@/lib/organizations/provision-personal'
import { resolveWorkspaceShellOrganizationId } from '@/lib/workspaces/shell-organization'
import { ExtensionWorkspace } from '@/app/(site)/extension/[workspaceId]/workspace'
import ExtensionLoading from '@/app/(site)/extension/loading'

interface ExtensionWorkspacePageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function ExtensionWorkspacePage({ params }: ExtensionWorkspacePageProps) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  // Where "Open in Sim" lands: the organization this workspace's pages render in for the viewer,
  // provisioned as the product shell does for someone in no organization (one who left a team).
  const organizationId = session?.user?.id
    ? await resolveWorkspaceShellOrganizationId(
        workspaceId,
        session.user.id,
        resolveOrProvisionLandingOrganization
      )
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
