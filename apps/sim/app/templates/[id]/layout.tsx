import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TemplateLayoutProps {
  children: React.ReactNode
  params: Promise<{
    id: string
  }>
}

/**
 * Template detail layout (public scope).
 * - If user is authenticated, redirect to workspace-scoped template detail.
 * - Otherwise render the public template detail children.
 */
export default async function TemplateDetailLayout({ children, params }: TemplateLayoutProps) {
  const { id } = await params
  const session = await getSession()

  if (session?.user?.id) {
    const userWorkspaces = await db
      .select({
        workspace: workspace,
      })
      .from(permissions)
      .innerJoin(workspace, eq(permissions.entityId, workspace.id))
      .where(and(eq(permissions.userId, session.user.id), eq(permissions.entityType, 'workspace')))
      .orderBy(desc(workspace.createdAt))
      .limit(1)

    if (userWorkspaces.length > 0) {
      const firstWorkspace = userWorkspaces[0].workspace
      redirect(`/workspace/${firstWorkspace.id}/templates/${id}`)
    }
  }

  return children
}
