import { db } from '@sim/db'
import { settings, templateCreators, templateStars, templates, user } from '@sim/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import type { Template } from '@/app/templates/templates'
import Templates from '@/app/templates/templates'

export default async function TemplatesPage() {
  const session = await getSession()

  // Check if user is a super user and if super user mode is enabled
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

    // Effective super user = database status AND UI mode enabled
    effectiveSuperUser = isSuperUser && superUserModeEnabled
  }

  // Fetch templates based on user status
  let templatesData

  if (session?.user?.id) {
    // Build where condition based on super user status
    const whereCondition = effectiveSuperUser ? undefined : eq(templates.status, 'approved')

    // Logged-in users: include star status
    templatesData = await db
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
    // Non-logged-in users: only approved templates, no star status
    templatesData = await db
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
  }

  return (
    <Templates
      initialTemplates={templatesData as unknown as Template[]}
      currentUserId={session?.user?.id || null}
      isSuperUser={effectiveSuperUser}
    />
  )
}
