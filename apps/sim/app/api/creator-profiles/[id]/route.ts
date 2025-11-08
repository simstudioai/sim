import { db } from '@sim/db'
import { member, templateCreators } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CreatorProfileByIdAPI')

const CreatorProfileDetailsSchema = z.object({
  about: z.string().max(2000, 'Max 2000 characters').optional(),
  xUrl: z.string().url().optional().or(z.literal('')),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
})

const UpdateCreatorProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Max 100 characters').optional(),
  profileImageUrl: z.string().optional().or(z.literal('')),
  details: CreatorProfileDetailsSchema.optional(),
})

// Helper to check if user has permission to manage profile
async function hasPermission(userId: string, profile: any): Promise<boolean> {
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

// GET /api/creator-profiles/[id] - Get a specific creator profile
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

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
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching creator profile: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/creator-profiles/[id] - Update a creator profile
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized update attempt for profile: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = UpdateCreatorProfileSchema.parse(body)

    // Check if profile exists
    const existing = await db
      .select()
      .from(templateCreators)
      .where(eq(templateCreators.id, id))
      .limit(1)

    if (existing.length === 0) {
      logger.warn(`[${requestId}] Profile not found for update: ${id}`)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check permissions
    const canEdit = await hasPermission(session.user.id, existing[0])
    if (!canEdit) {
      logger.warn(`[${requestId}] User denied permission to update profile: ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const updateData: any = {
      updatedAt: new Date(),
    }

    if (data.name !== undefined) updateData.name = data.name
    if (data.profileImageUrl !== undefined) updateData.profileImageUrl = data.profileImageUrl
    if (data.details !== undefined) updateData.details = data.details

    const updated = await db
      .update(templateCreators)
      .set(updateData)
      .where(eq(templateCreators.id, id))
      .returning()

    logger.info(`[${requestId}] Successfully updated creator profile: ${id}`)

    return NextResponse.json({ data: updated[0] })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid update data for profile: ${id}`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid update data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating creator profile: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/creator-profiles/[id] - Delete a creator profile
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

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

    if (existing.length === 0) {
      logger.warn(`[${requestId}] Profile not found for delete: ${id}`)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Check permissions
    const canDelete = await hasPermission(session.user.id, existing[0])
    if (!canDelete) {
      logger.warn(`[${requestId}] User denied permission to delete profile: ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await db.delete(templateCreators).where(eq(templateCreators.id, id))

    logger.info(`[${requestId}] Successfully deleted creator profile: ${id}`)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting creator profile: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
