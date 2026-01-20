import { db } from '@sim/db'
import { member, settings, templateCreators, templates, user } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'

export type CreatorPermissionLevel = 'member' | 'admin'

/**
 * Verifies if a user is an effective super user (database flag AND settings toggle).
 * This should be used for features that can be disabled by the user's settings toggle.
 *
 * @param userId - The ID of the user to check
 * @returns Object with effectiveSuperUser boolean and component values
 */
export async function verifyEffectiveSuperUser(userId: string): Promise<{
  effectiveSuperUser: boolean
  isSuperUser: boolean
  superUserModeEnabled: boolean
}> {
  const [currentUser] = await db
    .select({ isSuperUser: user.isSuperUser })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  const [userSettings] = await db
    .select({ superUserModeEnabled: settings.superUserModeEnabled })
    .from(settings)
    .where(eq(settings.userId, userId))
    .limit(1)

  const isSuperUser = currentUser?.isSuperUser || false
  const superUserModeEnabled = userSettings?.superUserModeEnabled ?? false

  return {
    effectiveSuperUser: isSuperUser && superUserModeEnabled,
    isSuperUser,
    superUserModeEnabled,
  }
}

/**
 * Fetches a template and verifies the user has permission to modify it.
 * Combines template existence check and creator permission check in one call.
 *
 * @param templateId - The ID of the template
 * @param userId - The ID of the user to check
 * @param requiredLevel - The permission level required ('member' or 'admin')
 * @returns Object with template data if authorized, or error information
 */
export async function verifyTemplateOwnership(
  templateId: string,
  userId: string,
  requiredLevel: CreatorPermissionLevel = 'admin'
): Promise<{
  authorized: boolean
  template?: typeof templates.$inferSelect
  error?: string
  status?: number
}> {
  const [template] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1)

  if (!template) {
    return { authorized: false, error: 'Template not found', status: 404 }
  }

  if (!template.creatorId) {
    return { authorized: false, error: 'Access denied', status: 403 }
  }

  const { hasPermission, error } = await verifyCreatorPermission(
    userId,
    template.creatorId,
    requiredLevel
  )

  if (!hasPermission) {
    return { authorized: false, error: error || 'Access denied', status: 403 }
  }

  return { authorized: true, template }
}

/**
 * Verifies if a user has permission to act on behalf of a creator profile.
 *
 * @param userId - The ID of the user to check
 * @param creatorId - The ID of the creator profile
 * @param requiredLevel - The permission level required ('member' for any org member, 'admin' for admin/owner only)
 * @returns Object with hasPermission boolean and optional error message
 */
export async function verifyCreatorPermission(
  userId: string,
  creatorId: string,
  requiredLevel: CreatorPermissionLevel = 'admin'
): Promise<{ hasPermission: boolean; error?: string }> {
  const creatorProfile = await db
    .select()
    .from(templateCreators)
    .where(eq(templateCreators.id, creatorId))
    .limit(1)

  if (creatorProfile.length === 0) {
    return { hasPermission: false, error: 'Creator profile not found' }
  }

  const creator = creatorProfile[0]

  if (creator.referenceType === 'user') {
    const hasPermission = creator.referenceId === userId
    return {
      hasPermission,
      error: hasPermission ? undefined : 'You do not have permission to use this creator profile',
    }
  }

  if (creator.referenceType === 'organization') {
    const membershipConditions = [
      eq(member.userId, userId),
      eq(member.organizationId, creator.referenceId),
    ]

    if (requiredLevel === 'admin') {
      membershipConditions.push(or(eq(member.role, 'admin'), eq(member.role, 'owner'))!)
    }

    const membership = await db
      .select()
      .from(member)
      .where(and(...membershipConditions))
      .limit(1)

    if (membership.length === 0) {
      const error =
        requiredLevel === 'admin'
          ? 'You must be an admin or owner of the organization to perform this action'
          : 'You must be a member of the organization to use its creator profile'
      return { hasPermission: false, error }
    }

    return { hasPermission: true }
  }

  return { hasPermission: false, error: 'Unknown creator profile type' }
}
