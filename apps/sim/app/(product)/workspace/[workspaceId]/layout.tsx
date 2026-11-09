import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { ShellOrganizationGuard } from '@/app/(product)/_components/shell-organization-guard/shell-organization-guard'
import { WorkspaceSession } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

interface WorkspaceLayoutProps {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

/**
 * Authorizes the workspace the URL names: a workspace the viewer cannot open is not found, so its
 * organization never shows. It renders in its organization's shell, an organization-less one in the
 * viewer's own; a workspace in another organization than the shell's reloads.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  if (resolvePlatformMode() !== 'live')
    return <WorkspaceSession mode='fixture'>{children}</WorkspaceSession>
  const [
    { workspaceId },
    { readWorkspaceShellOrganizationId },
    { WorkspaceRealtime },
    { readWorkspaceTabFlags },
  ] = await Promise.all([
    params,
    import('@/platform/lib/data/shell-scope'),
    import('@/platform/lib/data/realtime'),
    import('@/platform/lib/data/workspace-tab-flags'),
  ])
  const organizationId = await readWorkspaceShellOrganizationId(workspaceId)
  if (!organizationId) notFound()
  return (
    <ShellOrganizationGuard organizationId={organizationId}>
      <WorkspaceSession mode='live' tabFlags={await readWorkspaceTabFlags()}>
        <WorkspaceRealtime>{children}</WorkspaceRealtime>
      </WorkspaceSession>
    </ShellOrganizationGuard>
  )
}
