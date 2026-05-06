import { db } from '@sim/db'
import { member, templateCreators } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type CreatorProfileDetails,
  createCreatorProfileContract,
  listCreatorProfilesQuerySchema,
} from '@/lib/api/contracts/creator-profile'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CreatorProfilesAPI')

// GET /api/creators - Get creator profiles for current user
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  const queryResult = listCreatorProfilesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!queryResult.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestedUserId = queryResult.data.userId
    if (requestedUserId && requestedUserId !== session.user.id) {
      return NextResponse.json({ profiles: [] })
    }

    if (requestedUserId) {
      const profiles = await db
        .select()
        .from(templateCreators)
        .where(
          and(
            eq(templateCreators.referenceType, 'user'),
            eq(templateCreators.referenceId, requestedUserId)
          )
        )

      logger.info(`[${requestId}] Retrieved ${profiles.length} creator profiles`)

      return NextResponse.json({ profiles })
    }

    // Get user's organizations where they're admin or owner
    const userOrgs = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(
          eq(member.userId, session.user.id),
          or(eq(member.role, 'owner'), eq(member.role, 'admin'))
        )
      )

    const orgIds = userOrgs.map((m) => m.organizationId)

    // Get creator profiles for user and their organizations
    const profiles = await db
      .select()
      .from(templateCreators)
      .where(
        or(
          and(
            eq(templateCreators.referenceType, 'user'),
            eq(templateCreators.referenceId, session.user.id)
          ),
          ...orgIds.map((orgId) =>
            and(
              eq(templateCreators.referenceType, 'organization'),
              eq(templateCreators.referenceId, orgId)
            )
          )
        )
      )

    logger.info(`[${requestId}] Retrieved ${profiles.length} creator profiles`)

    return NextResponse.json({ profiles })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching creator profiles`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

// POST /api/creators - Create a new creator profile
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      createCreatorProfileContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid profile data`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid profile data')
        },
      }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    if (data.referenceType === 'user') {
      if (data.referenceId !== session.user.id) {
        logger.warn(`[${requestId}] User tried to create profile for another user`)
        return NextResponse.json(
          { error: 'Cannot create profile for another user' },
          { status: 403 }
        )
      }
    } else if (data.referenceType === 'organization') {
      // Check if user is admin/owner of the organization
      const membership = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(member.organizationId, data.referenceId),
            or(eq(member.role, 'owner'), eq(member.role, 'admin'))
          )
        )
        .limit(1)

      if (membership.length === 0) {
        logger.warn(`[${requestId}] User not authorized for organization: ${data.referenceId}`)
        return NextResponse.json(
          { error: 'You must be an admin or owner to create an organization profile' },
          { status: 403 }
        )
      }
    }

    // Check if profile already exists
    const existing = await db
      .select()
      .from(templateCreators)
      .where(
        and(
          eq(templateCreators.referenceType, data.referenceType),
          eq(templateCreators.referenceId, data.referenceId)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      logger.warn(
        `[${requestId}] Profile already exists for ${data.referenceType}:${data.referenceId}`
      )
      return NextResponse.json({ error: 'Creator profile already exists' }, { status: 409 })
    }

    // Create the profile
    const profileId = generateId()
    const now = new Date()

    const details: CreatorProfileDetails = {}
    if (data.details?.about) details.about = data.details.about
    if (data.details?.xUrl) details.xUrl = data.details.xUrl
    if (data.details?.linkedinUrl) details.linkedinUrl = data.details.linkedinUrl
    if (data.details?.websiteUrl) details.websiteUrl = data.details.websiteUrl
    if (data.details?.contactEmail) details.contactEmail = data.details.contactEmail

    const newProfile = {
      id: profileId,
      referenceType: data.referenceType,
      referenceId: data.referenceId,
      name: data.name,
      profileImageUrl: data.profileImageUrl || null,
      details: Object.keys(details).length > 0 ? details : null,
      verified: false,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(templateCreators).values(newProfile)

    logger.info(`[${requestId}] Successfully created creator profile: ${profileId}`)

    return NextResponse.json({ data: newProfile }, { status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error creating creator profile`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
