import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { getSession } from '@/lib/auth'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
import {
  isWorkspaceShellRefusal,
  readWorkspaceShell,
} from '@/lib/workspaces/application/workspace-shell'
import { ExtensionWorkspace } from '@/app/(site)/extension/[workspaceId]/workspace'
import ExtensionLoading from '@/app/(site)/extension/loading'

/**
 * Where "Open in Sim" lands: the organization this workspace's pages render in for the viewer,
 * provisioned as the product shell does for someone in no organization (one who left a team).
 * `null` for a workspace they cannot open.
 */
async function openingOrganizationId(
  principal: SessionPrincipal,
  workspaceId: string
): Promise<string | null> {
  try {
    const shell = await readWorkspaceShell.execute({ principal, input: { workspaceId } })
    return (
      shell.organizationId ?? (await ensureViewerOrganization.execute({ principal, input: {} }))
    )
  } catch (error) {
    if (isWorkspaceShellRefusal(error)) return null
    throw error
  }
}

interface ExtensionWorkspacePageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function ExtensionWorkspacePage({ params }: ExtensionWorkspacePageProps) {
  const [{ workspaceId }, session] = await Promise.all([params, getSession()])
  const organizationId = session?.user?.id
    ? await openingOrganizationId(
        { kind: 'session', userId: session.user.id, sessionId: session.session.id },
        workspaceId
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
