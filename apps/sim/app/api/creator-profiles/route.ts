import { db } from '@sim/db'
import { member, templateCreators } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import type { CreatorProfileDetails } from '@/types/creator-profile'

const logger = createLogger('CreatorProfilesAPI')

const CreatorProfileDetailsSchema = z.object({
  about: z.string().max(2000, 'Max 2000 characters').optional(),
  xUrl: z.string().url().optional().or(z.literal('')),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
})

const CreateCreatorProfileSchema = z.object({
  referenceType: z.enum(['user', 'organization']),
  referenceId: z.string().min(1, 'Reference ID is required'),
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters'),
  profileImageUrl: z.string().min(1, 'Profile image is required'),
  details: CreatorProfileDetailsSchema.optional(),
})

// GET /api/creator-profiles - Get creator profiles for current user
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching creator profiles`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/creator-profiles - Create a new creator profile
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = CreateCreatorProfileSchema.parse(body)

    logger.debug(`[${requestId}] Creating creator profile:`, {
      referenceType: data.referenceType,
      referenceId: data.referenceId,
    })

    // Validate permissions
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
    const profileId = uuidv4()
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
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(templateCreators).values(newProfile)

    logger.info(`[${requestId}] Successfully created creator profile: ${profileId}`)

    return NextResponse.json({ data: newProfile }, { status: 201 })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid profile data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid profile data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating creator profile`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
