import { db } from '@sim/db'
import { templateCreators, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('CreatorVerificationAPI')

export const revalidate = 0

// POST /api/creators/[id]/verify - Verify a creator (super users only)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized verification attempt for creator: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is a super user
    const currentUser = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)

    if (!currentUser[0]?.isSuperUser) {
      logger.warn(`[${requestId}] Non-super user attempted to verify creator: ${id}`)
      return NextResponse.json({ error: 'Only super users can verify creators' }, { status: 403 })
    }

    // Check if creator exists
    const existingCreator = await db
      .select()
      .from(templateCreators)
      .where(eq(templateCreators.id, id))
      .limit(1)

    if (existingCreator.length === 0) {
      logger.warn(`[${requestId}] Creator not found for verification: ${id}`)
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    // Update creator verified status to true
    await db
      .update(templateCreators)
      .set({ verified: true, updatedAt: new Date() })
      .where(eq(templateCreators.id, id))

    logger.info(`[${requestId}] Creator verified: ${id} by super user: ${session.user.id}`)

    return NextResponse.json({
      message: 'Creator verified successfully',
      creatorId: id,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error verifying creator ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/creators/[id]/verify - Unverify a creator (super users only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized unverification attempt for creator: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is a super user
    const currentUser = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)

    if (!currentUser[0]?.isSuperUser) {
      logger.warn(`[${requestId}] Non-super user attempted to unverify creator: ${id}`)
      return NextResponse.json({ error: 'Only super users can unverify creators' }, { status: 403 })
    }

    // Check if creator exists
    const existingCreator = await db
      .select()
      .from(templateCreators)
      .where(eq(templateCreators.id, id))
      .limit(1)

    if (existingCreator.length === 0) {
      logger.warn(`[${requestId}] Creator not found for unverification: ${id}`)
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 })
    }

    // Update creator verified status to false
    await db
      .update(templateCreators)
      .set({ verified: false, updatedAt: new Date() })
      .where(eq(templateCreators.id, id))

    logger.info(`[${requestId}] Creator unverified: ${id} by super user: ${session.user.id}`)

    return NextResponse.json({
      message: 'Creator unverified successfully',
      creatorId: id,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error unverifying creator ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
