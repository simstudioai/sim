import { db } from '@sim/db'
import { settings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('CopilotAutoAllowedToolsAPI')

/**
 * GET - Fetch user's auto-allowed integration tools
 */
export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const [userSettings] = await db
      .select()
      .from(settings)
      .where(eq(settings.userId, userId))
      .limit(1)

    if (userSettings) {
      const autoAllowedTools = (userSettings.copilotAutoAllowedTools as string[]) || []
      return NextResponse.json({ autoAllowedTools })
    }

    await db.insert(settings).values({
      id: userId,
      userId,
      copilotAutoAllowedTools: [],
    })

    return NextResponse.json({ autoAllowedTools: [] })
  } catch (error) {
    logger.error('Failed to fetch auto-allowed tools', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Add a tool to the auto-allowed list
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    if (!body.toolId || typeof body.toolId !== 'string') {
      return NextResponse.json({ error: 'toolId must be a string' }, { status: 400 })
    }

    const toolId = body.toolId

    const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (existing) {
      const currentTools = (existing.copilotAutoAllowedTools as string[]) || []

      if (!currentTools.includes(toolId)) {
        const updatedTools = [...currentTools, toolId]
        await db
          .update(settings)
          .set({
            copilotAutoAllowedTools: updatedTools,
            updatedAt: new Date(),
          })
          .where(eq(settings.userId, userId))

        logger.info('Added tool to auto-allowed list', { userId, toolId })
        return NextResponse.json({ success: true, autoAllowedTools: updatedTools })
      }

      return NextResponse.json({ success: true, autoAllowedTools: currentTools })
    }

    await db.insert(settings).values({
      id: userId,
      userId,
      copilotAutoAllowedTools: [toolId],
    })

    logger.info('Created settings and added tool to auto-allowed list', { userId, toolId })
    return NextResponse.json({ success: true, autoAllowedTools: [toolId] })
  } catch (error) {
    logger.error('Failed to add auto-allowed tool', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Remove a tool from the auto-allowed list
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { searchParams } = new URL(request.url)
    const toolId = searchParams.get('toolId')

    if (!toolId) {
      return NextResponse.json({ error: 'toolId query parameter is required' }, { status: 400 })
    }

    const [existing] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1)

    if (existing) {
      const currentTools = (existing.copilotAutoAllowedTools as string[]) || []
      const updatedTools = currentTools.filter((t) => t !== toolId)

      await db
        .update(settings)
        .set({
          copilotAutoAllowedTools: updatedTools,
          updatedAt: new Date(),
        })
        .where(eq(settings.userId, userId))

      logger.info('Removed tool from auto-allowed list', { userId, toolId })
      return NextResponse.json({ success: true, autoAllowedTools: updatedTools })
    }

    return NextResponse.json({ success: true, autoAllowedTools: [] })
  } catch (error) {
    logger.error('Failed to remove auto-allowed tool', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
