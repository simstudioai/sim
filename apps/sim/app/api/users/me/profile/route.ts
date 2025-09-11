import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { user } from '@/db/schema'

const logger = createLogger('UpdateUserProfileAPI')

// Schema for updating user profile
const UpdateProfileSchema = z
  .object({
    name: z.string().min(1, 'Name is required').optional(),
    image: z.string().url('Invalid image URL').optional(),
  })
  .refine((data) => data.name !== undefined || data.image !== undefined, {
    message: 'At least one field (name or image) must be provided',
  })

interface UpdateData {
  updatedAt: Date
  name?: string
  image?: string | null
}

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized profile update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    const validatedData = UpdateProfileSchema.parse(body)

    // Build update object
    const updateData: UpdateData = { updatedAt: new Date() }
    if (validatedData.name !== undefined) updateData.name = validatedData.name
    if (validatedData.image !== undefined) updateData.image = validatedData.image

    // Update user profile
    const [updatedUser] = await db
      .update(user)
      .set(updateData)
      .where(eq(user.id, userId))
      .returning()

    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] User profile updated`, {
      userId,
      updatedFields: Object.keys(validatedData),
    })

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        image: updatedUser.image,
      },
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid profile data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid profile data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Profile update error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET endpoint to fetch current user profile
export async function GET() {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized profile fetch attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const [userRecord] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userRecord) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      user: userRecord,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Profile fetch error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
