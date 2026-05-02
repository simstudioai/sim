import { db } from '@sim/db'
import { member, templateCreators } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  creatorProfileParamsSchema,
  updateCreatorProfileContract,
} from '@/lib/api/contracts/creator-profile'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CreatorProfileByIdAPI')

type CreatorProfileRow = typeof templateCreators.$inferSelect
type CreatorProfileUpdate = Partial<
  Pick<CreatorProfileRow, 'name' | 'profileImageUrl' | 'details' | 'verified'>
> & {
  updatedAt: Date
}

// Helper to check if user has permission to manage profile
async function hasPermission(userId: string, profile: CreatorProfileRow): Promise<boolean> {
  if (profile.referenceType === 'user') {
    return profile.referenceId === userId
  }
  if (profile.referenceType === 'organization') {
    const membership = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, profile.referenceId),
          or(eq(member.role, 'owner'), eq(member.role, 'admin'))
        )
      )
      .limit(1)
    return membership.length > 0
  }
  return false
}

// GET /api/creators/[id] - Get a specific creator profile
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const paramsResult = creatorProfileParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json({ error: 'Invalid route parameters' }, { status: 400 })
    }
    const { id } = paramsResult.data

    try {
      const profile = await db
        .select()
        .from(templateCreators)
        .where(eq(templateCreators.id, id))
        .limit(1)

      if (profile.length === 0) {
        logger.warn(`[${requestId}] Profile not found: ${id}`)
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }

      logger.info(`[${requestId}] Retrieved creator profile: ${id}`)
      return NextResponse.json({ data: profile[0] })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching creator profile: ${id}`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

// PUT /api/creators/[id] - Update a creator profile
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateCreatorProfileContract, request, context, {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid update data`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid update data')
        },
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const data = parsed.data.body

      // Check if profile exists
      const existing = await db
        .select()
        .from(templateCreators)
        .where(eq(templateCreators.id, id))
        .limit(1)

      const existingProfile = existing[0]
      if (!existingProfile) {
        logger.warn(`[${requestId}] Profile not found for update: ${id}`)
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }

      // Verification changes require super user permission
      if (data.verified !== undefined) {
        const { verifyEffectiveSuperUser } = await import('@/lib/templates/permissions')
        const { effectiveSuperUser } = await verifyEffectiveSuperUser(session.user.id)
        if (!effectiveSuperUser) {
          logger.warn(
            `[${requestId}] Non-super user attempted to change creator verification: ${id}`
          )
          return NextResponse.json(
            { error: 'Only super users can change verification status' },
            { status: 403 }
          )
        }
      }

      // For non-verified updates, check regular permissions
      const hasNonVerifiedUpdates =
        data.name !== undefined || data.profileImageUrl !== undefined || data.details !== undefined

      if (hasNonVerifiedUpdates) {
        const canEdit = await hasPermission(session.user.id, existingProfile)
        if (!canEdit) {
          logger.warn(`[${requestId}] User denied permission to update profile: ${id}`)
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }
      }

      const updateData: CreatorProfileUpdate = {
        updatedAt: new Date(),
      }

      if (data.name !== undefined) updateData.name = data.name
      if (data.profileImageUrl !== undefined) updateData.profileImageUrl = data.profileImageUrl
      if (data.details !== undefined) updateData.details = data.details
      if (data.verified !== undefined) updateData.verified = data.verified

      const updated = await db
        .update(templateCreators)
        .set(updateData)
        .where(eq(templateCreators.id, id))
        .returning()

      logger.info(`[${requestId}] Successfully updated creator profile: ${id}`)

      return NextResponse.json({ data: updated[0] })
    } catch (error) {
      logger.error(`[${requestId}] Error updating creator profile`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

// DELETE /api/creators/[id] - Delete a creator profile
export const DELETE = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const paramsResult = creatorProfileParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json({ error: 'Invalid route parameters' }, { status: 400 })
    }
    const { id } = paramsResult.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized delete attempt for profile: ${id}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Check if profile exists
      const existing = await db
        .select()
        .from(templateCreators)
        .where(eq(templateCreators.id, id))
        .limit(1)

      const existingProfile = existing[0]
      if (!existingProfile) {
        logger.warn(`[${requestId}] Profile not found for delete: ${id}`)
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }

      // Check permissions
      const canDelete = await hasPermission(session.user.id, existingProfile)
      if (!canDelete) {
        logger.warn(`[${requestId}] User denied permission to delete profile: ${id}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      await db.delete(templateCreators).where(eq(templateCreators.id, id))

      logger.info(`[${requestId}] Successfully deleted creator profile: ${id}`)
      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting creator profile: ${id}`, error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
