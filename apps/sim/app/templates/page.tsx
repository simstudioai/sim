import { db } from '@sim/db'
import { permissions, templateCreators, templates, workspace } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import type { Template } from '@/app/templates/templates'
import Templates from '@/app/templates/templates'

/**
 * Public templates list page.
 * Redirects authenticated users to their workspace-scoped templates page.
 * Allows unauthenticated users to view templates for SEO and discovery.
 */
export default async function TemplatesPage() {
  const session = await getSession()

  // Authenticated users: redirect to workspace-scoped templates
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
      redirect(`/workspace/${firstWorkspace.id}/templates`)
    }
  }

  // Unauthenticated users: show public templates
  const templatesData = await db
    .select({
      id: templates.id,
      workflowId: templates.workflowId,
      name: templates.name,
      details: templates.details,
      creatorId: templates.creatorId,
      creator: templateCreators,
      views: templates.views,
      stars: templates.stars,
      status: templates.status,
      tags: templates.tags,
      requiredCredentials: templates.requiredCredentials,
      state: templates.state,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
    .where(eq(templates.status, 'approved'))
    .orderBy(desc(templates.views), desc(templates.createdAt))
    .then((rows) => rows.map((row) => ({ ...row, isStarred: false })))

  return (
    <Templates
      initialTemplates={templatesData as unknown as Template[]}
      currentUserId={null}
      isSuperUser={false}
    />
  )
}
