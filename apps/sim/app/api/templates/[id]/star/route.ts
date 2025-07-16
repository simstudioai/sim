import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templateStars, templates } from '@/db/schema'

const logger = createLogger('TemplateStarAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/templates/[id]/star - Check if user has starred this template
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized star check attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.debug(
      `[${requestId}] Checking star status for template: ${id}, user: ${session.user.id}`
    )

    // Check if the user has starred this template
    const starRecord = await db
      .select({ id: templateStars.id })
      .from(templateStars)
      .where(and(eq(templateStars.templateId, id), eq(templateStars.userId, session.user.id)))
      .limit(1)

    const isStarred = starRecord.length > 0

    logger.info(`[${requestId}] Star status checked: ${isStarred} for template: ${id}`)

    return NextResponse.json({ data: { isStarred } })
  } catch (error: any) {
    logger.error(`[${requestId}] Error checking star status for template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/templates/[id]/star - Add a star to the template
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized star attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.debug(`[${requestId}] Adding star for template: ${id}, user: ${session.user.id}`)

    // Verify the template exists
    const templateExists = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (templateExists.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Check if user has already starred this template
    const existingStar = await db
      .select({ id: templateStars.id })
      .from(templateStars)
      .where(and(eq(templateStars.templateId, id), eq(templateStars.userId, session.user.id)))
      .limit(1)

    if (existingStar.length > 0) {
      logger.info(`[${requestId}] Template already starred: ${id}`)
      return NextResponse.json({ message: 'Template already starred' }, { status: 200 })
    }

    // Use a transaction to ensure consistency
    await db.transaction(async (tx) => {
      // Add the star record
      await tx.insert(templateStars).values({
        id: uuidv4(),
        userId: session.user.id,
        templateId: id,
        starredAt: new Date(),
        createdAt: new Date(),
      })

      // Increment the star count
      await tx
        .update(templates)
        .set({
          stars: sql`${templates.stars} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))
    })

    logger.info(`[${requestId}] Successfully starred template: ${id}`)
    return NextResponse.json({ message: 'Template starred successfully' }, { status: 201 })
  } catch (error: any) {
    // Handle unique constraint violations gracefully
    if (error.code === '23505') {
      logger.info(`[${requestId}] Duplicate star attempt for template: ${id}`)
      return NextResponse.json({ message: 'Template already starred' }, { status: 200 })
    }

    logger.error(`[${requestId}] Error starring template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/templates/[id]/star - Remove a star from the template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized unstar attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.debug(`[${requestId}] Removing star for template: ${id}, user: ${session.user.id}`)

    // Check if the star exists
    const existingStar = await db
      .select({ id: templateStars.id })
      .from(templateStars)
      .where(and(eq(templateStars.templateId, id), eq(templateStars.userId, session.user.id)))
      .limit(1)

    if (existingStar.length === 0) {
      logger.info(`[${requestId}] No star found to remove for template: ${id}`)
      return NextResponse.json({ message: 'Template not starred' }, { status: 200 })
    }

    // Use a transaction to ensure consistency
    await db.transaction(async (tx) => {
      // Remove the star record
      await tx
        .delete(templateStars)
        .where(and(eq(templateStars.templateId, id), eq(templateStars.userId, session.user.id)))

      // Decrement the star count (prevent negative values)
      await tx
        .update(templates)
        .set({
          stars: sql`GREATEST(${templates.stars} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))
    })

    logger.info(`[${requestId}] Successfully unstarred template: ${id}`)
    return NextResponse.json({ message: 'Template unstarred successfully' }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error unstarring template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
