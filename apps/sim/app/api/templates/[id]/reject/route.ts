import { db } from '@sim/db'
import { templates, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TemplateRejectionAPI')

export const revalidate = 0

// POST /api/templates/[id]/reject - Reject a template (super users only)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized template rejection attempt for ID: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is a super user
    const currentUser = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1)

    if (!currentUser[0]?.isSuperUser) {
      logger.warn(`[${requestId}] Non-super user attempted to reject template: ${id}`)
      return NextResponse.json({ error: 'Only super users can reject templates' }, { status: 403 })
    }

    // Check if template exists
    const existingTemplate = await db.select().from(templates).where(eq(templates.id, id)).limit(1)

    if (existingTemplate.length === 0) {
      logger.warn(`[${requestId}] Template not found for rejection: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Update template status to rejected
    await db
      .update(templates)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(templates.id, id))

    logger.info(`[${requestId}] Template rejected: ${id} by super user: ${session.user.id}`)

    return NextResponse.json({
      message: 'Template rejected successfully',
      templateId: id,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error rejecting template ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
