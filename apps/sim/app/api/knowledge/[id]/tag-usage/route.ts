import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getTagUsage } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TagUsageAPI')

// GET /api/knowledge/[id]/tag-usage - Get usage statistics for all tag definitions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Getting tag usage statistics for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const usageStats = await getTagUsage(knowledgeBaseId, requestId)

    logger.info(
      `[${requestId}] Retrieved usage statistics for ${usageStats.length} tag definitions`
    )

    return NextResponse.json({
      success: true,
      data: usageStats,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag usage statistics`, error)
    return NextResponse.json({ error: 'Failed to get tag usage statistics' }, { status: 500 })
  }
}
