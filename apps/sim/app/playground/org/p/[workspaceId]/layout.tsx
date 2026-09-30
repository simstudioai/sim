import type { ReactNode } from 'react'
import { MOCK_PROJECT_IDS } from '@/app/playground/org/lib/project'
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
  if (MOCK_PROJECT_IDS.has(workspaceId)) return children
  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      {children}
    </WorkspacePermissionsProvider>
  )
}
