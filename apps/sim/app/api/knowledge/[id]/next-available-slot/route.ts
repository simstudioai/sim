import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getNextAvailableSlot, getTagDefinitions } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('NextAvailableSlotAPI')

// GET /api/knowledge/[id]/next-available-slot - Get the next available tag slot for a knowledge base and field type
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params
  const { searchParams } = new URL(req.url)
  const fieldType = searchParams.get('fieldType')

  if (!fieldType) {
    return NextResponse.json({ error: 'fieldType parameter is required' }, { status: 400 })
  }

  try {
    logger.info(
      `[${requestId}] Getting next available slot for knowledge base ${knowledgeBaseId}, fieldType: ${fieldType}`
    )

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get existing definitions once and reuse
    const existingDefinitions = await getTagDefinitions(knowledgeBaseId)
    const usedSlots = existingDefinitions
      .filter((def) => def.fieldType === fieldType)
      .map((def) => def.tagSlot)

    // Create a map for efficient lookup and pass to avoid redundant query
    const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot as string, def]))
    const nextAvailableSlot = await getNextAvailableSlot(knowledgeBaseId, fieldType, existingBySlot)

    logger.info(
      `[${requestId}] Next available slot for fieldType ${fieldType}: ${nextAvailableSlot}`
    )

    const result = {
      nextAvailableSlot,
      fieldType,
      usedSlots,
      totalSlots: 7,
      availableSlots: nextAvailableSlot ? 7 - usedSlots.length : 0,
    }

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting next available slot`, error)
    return NextResponse.json({ error: 'Failed to get next available slot' }, { status: 500 })
  }
}
