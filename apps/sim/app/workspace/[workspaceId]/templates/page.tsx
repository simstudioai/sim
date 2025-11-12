import { db } from '@sim/db'
import { settings, templateCreators, templateStars, templates, user } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import type { Template as WorkspaceTemplate } from '@/app/workspace/[workspaceId]/templates/templates'
import Templates from '@/app/workspace/[workspaceId]/templates/templates'

/**
 * Workspace-scoped Templates page.
 *
 * Mirrors the global templates data loading while rendering the workspace
 * templates UI (which accounts for the sidebar layout). This avoids redirecting
 * to the global /templates route and keeps users within their workspace context.
 */
export default async function TemplatesPage() {
  const session = await getSession()

  // Determine effective super user (DB flag AND UI mode enabled)
  let effectiveSuperUser = false
  if (session?.user?.id) {
    const currentUser = await db
      .select({ isSuperUser: user.isSuperUser })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)
    const userSettings = await db
      .select({ superUserModeEnabled: settings.superUserModeEnabled })
      .from(settings)
      .where(eq(settings.userId, session.user.id))
      .limit(1)

    const isSuperUser = currentUser[0]?.isSuperUser || false
    const superUserModeEnabled = userSettings[0]?.superUserModeEnabled ?? true
    effectiveSuperUser = isSuperUser && superUserModeEnabled
  }

  // Load templates (same logic as global page)
  let rows:
    | Array<{
        id: string
        workflowId: string | null
        name: string
        details?: any
        creatorId: string | null
        creator: {
          id: string
          referenceType: 'user' | 'organization'
          referenceId: string
          name: string
          profileImageUrl?: string | null
          details?: unknown
        } | null
        views: number
        stars: number
        status: 'pending' | 'approved' | 'rejected'
        tags: string[]
        requiredCredentials: unknown
        state: unknown
        createdAt: Date | string
        updatedAt: Date | string
        isStarred?: boolean
      }>
    | undefined

  if (session?.user?.id) {
    const whereCondition = effectiveSuperUser ? undefined : eq(templates.status, 'approved')
    rows = await db
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
        isStarred: sql<boolean>`CASE WHEN ${templateStars.id} IS NOT NULL THEN true ELSE false END`,
      })
      .from(templates)
      .leftJoin(
        templateStars,
        and(eq(templateStars.templateId, templates.id), eq(templateStars.userId, session.user.id))
      )
      .leftJoin(templateCreators, eq(templates.creatorId, templateCreators.id))
      .where(whereCondition)
      .orderBy(desc(templates.views), desc(templates.createdAt))
  } else {
    rows = await db
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
      .then((r) => r.map((row) => ({ ...row, isStarred: false })))
  }

  const initialTemplates: WorkspaceTemplate[] =
    rows?.map((row) => {
      const authorType = (row.creator?.referenceType as 'user' | 'organization') ?? 'user'
      const organizationId =
        row.creator?.referenceType === 'organization' ? row.creator.referenceId : null
      const userId =
        row.creator?.referenceType === 'user' ? row.creator.referenceId : '' /* no owner context */

      return {
        id: row.id,
        workflowId: row.workflowId,
        userId,
        name: row.name,
        description: row.details?.tagline ?? null,
        author: row.creator?.name ?? 'Unknown',
        authorType,
        organizationId,
        views: row.views,
        stars: row.stars,
        color: '#3972F6', // default color for workspace cards
        icon: 'Workflow', // default icon for workspace cards
        status: row.status,
        state: row.state as WorkspaceTemplate['state'],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isStarred: row.isStarred ?? false,
        isSuperUser: effectiveSuperUser,
      }
    }) ?? []

  return (
    <Templates
      initialTemplates={initialTemplates}
      currentUserId={session?.user?.id || ''}
      isSuperUser={effectiveSuperUser}
    />
  )
}
