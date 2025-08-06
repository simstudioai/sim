import { randomUUID } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getMaxSlotsForFieldType, getSlotsForFieldType } from '@/lib/constants/knowledge'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'
import { db } from '@/db'
import { knowledgeBaseTagDefinitions } from '@/db/schema'

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

    // Check if user has read access to the knowledge base
    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get available slots for this field type
    const availableSlots = getSlotsForFieldType(fieldType)
    const maxSlots = getMaxSlotsForFieldType(fieldType)

    // Get existing tag definitions to find used slots for this field type
    const existingDefinitions = await db
      .select({ tagSlot: knowledgeBaseTagDefinitions.tagSlot })
      .from(knowledgeBaseTagDefinitions)
      .where(
        and(
          eq(knowledgeBaseTagDefinitions.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseTagDefinitions.fieldType, fieldType)
        )
      )

    const usedSlots = new Set(existingDefinitions.map((def) => def.tagSlot as string))

    // Find the first available slot for this field type
    let nextAvailableSlot: string | null = null
    for (const slot of availableSlots) {
      if (!usedSlots.has(slot)) {
        nextAvailableSlot = slot
        break
      }
    }

    logger.info(
      `[${requestId}] Next available slot for fieldType ${fieldType}: ${nextAvailableSlot}`
    )

    return NextResponse.json({
      success: true,
      data: {
        nextAvailableSlot,
        fieldType,
        usedSlots: Array.from(usedSlots),
        totalSlots: maxSlots,
        availableSlots: maxSlots - usedSlots.size,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting next available slot`, error)
    return NextResponse.json({ error: 'Failed to get next available slot' }, { status: 500 })
  }
}
