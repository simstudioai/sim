import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { WorkspaceSession } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

interface WorkspaceLayoutProps {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

/**
 * Authorizes the workspace the URL names: a workspace the viewer cannot open is not found, so its
 * organization never shows. It renders in the viewer's one organization's shell.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  if (resolvePlatformMode() !== 'live')
    return <WorkspaceSession mode='fixture'>{children}</WorkspaceSession>
  const [
    { workspaceId },
    { readWorkspaceShellOrganizationId },
    { WorkspaceRealtime },
    { readWorkspaceTabFlags },
    { WorkspaceVisit },
    { UploadGuard },
  ] = await Promise.all([
    params,
    import('@/platform/lib/data/shell-scope'),
    import('@/platform/lib/data/realtime'),
    import('@/platform/lib/data/workspace-tab-flags'),
    import('@/platform/lib/data/workspace-visit'),
    import('@/platform/lib/data/upload-guard'),
  ])
  const [organizationId, tabFlags] = await Promise.all([
    readWorkspaceShellOrganizationId(workspaceId),
    readWorkspaceTabFlags(),
  ])
  if (!organizationId) notFound()
  return (
    <WorkspaceSession mode='live' tabFlags={tabFlags}>
      <WorkspaceVisit workspaceId={workspaceId} />
      <UploadGuard />
      <WorkspaceRealtime>{children}</WorkspaceRealtime>
    </WorkspaceSession>
  )
}
