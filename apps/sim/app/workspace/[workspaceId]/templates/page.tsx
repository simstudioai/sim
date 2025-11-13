import { db } from '@sim/db'
import { settings, templateCreators, templateStars, templates, user } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import type { Template as WorkspaceTemplate } from '@/app/workspace/[workspaceId]/templates/templates'
import Templates from '@/app/workspace/[workspaceId]/templates/templates'

interface TemplatesPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

/**
 * Workspace-scoped Templates page.
 * Requires authentication and workspace membership to access.
 */
export default async function TemplatesPage({ params }: TemplatesPageProps) {
  const { workspaceId } = await params
  const session = await getSession()

  // Require authentication
  if (!session?.user?.id) {
    redirect('/login')
  }

  // Verify workspace membership
  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  // Determine effective super user (DB flag AND UI mode enabled)
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
  const effectiveSuperUser = isSuperUser && superUserModeEnabled

  // Load templates from database
  let rows:
    | Array<{
        id: string
        workflowId: string | null
        name: string
        details?: unknown
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
        // New structure fields
        id: row.id,
        workflowId: row.workflowId,
        name: row.name,
        details: row.details as { tagline?: string; about?: string } | null,
        creatorId: row.creatorId,
        creator: row.creator
          ? {
              id: row.creator.id,
              name: row.creator.name,
              profileImageUrl: row.creator.profileImageUrl,
              details: row.creator.details as {
                about?: string
                xUrl?: string
                linkedinUrl?: string
                websiteUrl?: string
                contactEmail?: string
              } | null,
              referenceType: row.creator.referenceType,
              referenceId: row.creator.referenceId,
            }
          : null,
        views: row.views,
        stars: row.stars,
        status: row.status,
        tags: row.tags,
        requiredCredentials: row.requiredCredentials,
        state: row.state as WorkspaceTemplate['state'],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isStarred: row.isStarred ?? false,
        isSuperUser: effectiveSuperUser,
        // Legacy fields for backward compatibility
        userId,
        description: (row.details as any)?.tagline ?? null,
        author: row.creator?.name ?? 'Unknown',
        authorType,
        organizationId,
        color: '#3972F6', // default color for workspace cards
        icon: 'Workflow', // default icon for workspace cards
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
