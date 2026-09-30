import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { isOrgProjectViewEnabled } from '@/lib/projects/feature-flag'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

/**
 * A project's pages, on while the org project view is rolled out to the organization. The
 * `[workspaceId]` segment lets the Chat components read the project's workspace from the route,
 * with the permissions its message actions expect.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ organizationId: string; workspaceId: string }>
}) {
  const { organizationId, workspaceId } = await params
  if (!(await isOrgProjectViewEnabled(organizationId))) notFound()
  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      {children}
    </WorkspacePermissionsProvider>
  )
}
