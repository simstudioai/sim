import type { ReactNode } from 'react'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

/**
 * A real `[workspaceId]` segment so the Chat components that read `useParams().workspaceId`
 * resolve the project's workspace, with the permissions the message actions expect.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      {children}
    </WorkspacePermissionsProvider>
  )
}
