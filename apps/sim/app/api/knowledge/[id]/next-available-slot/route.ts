import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { nextAvailableSlotContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getNextAvailableSlot, getTagDefinitions } from '@/lib/knowledge/tags/service'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('NextAvailableSlotAPI')

// GET /api/knowledge/[id]/next-available-slot - Get the next available tag slot for a knowledge base and field type
export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const parsed = await parseRequest(nextAvailableSlotContract, req, context)
    if (!parsed.success) {
      return NextResponse.json({ error: 'fieldType parameter is required' }, { status: 400 })
    }
    const { id: knowledgeBaseId } = parsed.data.params
    const { fieldType } = parsed.data.query

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
        return NextResponse.json(
          { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
          { status: accessCheck.notFound ? 404 : 403 }
        )
      }

      // Get existing definitions once and reuse
      const existingDefinitions = await getTagDefinitions(knowledgeBaseId)
      const usedSlots = existingDefinitions
        .filter((def) => def.fieldType === fieldType)
        .map((def) => def.tagSlot)

      // Create a map for efficient lookup and pass to avoid redundant query
      const existingBySlot = new Map(existingDefinitions.map((def) => [def.tagSlot as string, def]))
      const nextAvailableSlot = await getNextAvailableSlot(
        knowledgeBaseId,
        fieldType,
        existingBySlot
      )

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
)
