import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { SUPPORTED_FIELD_TYPES } from '@/lib/constants/knowledge'
import { createTagDefinition, getTagDefinitions } from '@/lib/knowledge/tags/service'
import { createLogger } from '@/lib/logs/console/logger'
import { checkKnowledgeBaseAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('KnowledgeBaseTagDefinitionsAPI')

// GET /api/knowledge/[id]/tag-definitions - Get all tag definitions for a knowledge base
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Getting tag definitions for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tagDefinitions = await getTagDefinitions(knowledgeBaseId)

    logger.info(`[${requestId}] Retrieved ${tagDefinitions.length} tag definitions`)

    return NextResponse.json({
      success: true,
      data: tagDefinitions,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting tag definitions`, error)
    return NextResponse.json({ error: 'Failed to get tag definitions' }, { status: 500 })
  }
}

// POST /api/knowledge/[id]/tag-definitions - Create a new tag definition
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID().slice(0, 8)
  const { id: knowledgeBaseId } = await params

  try {
    logger.info(`[${requestId}] Creating tag definition for knowledge base ${knowledgeBaseId}`)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()

    const CreateTagDefinitionSchema = z.object({
      tagSlot: z.string().min(1, 'Tag slot is required'),
      displayName: z.string().min(1, 'Display name is required'),
      fieldType: z.enum(SUPPORTED_FIELD_TYPES as [string, ...string[]], {
        errorMap: () => ({ message: 'Invalid field type' }),
      }),
    })

    let validatedData
    try {
      validatedData = CreateTagDefinitionSchema.parse(body)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      throw error
    }

    const newTagDefinition = await createTagDefinition(
      {
        knowledgeBaseId,
        tagSlot: validatedData.tagSlot,
        displayName: validatedData.displayName,
        fieldType: validatedData.fieldType,
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: newTagDefinition,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error creating tag definition`, error)
    return NextResponse.json({ error: 'Failed to create tag definition' }, { status: 500 })
  }
}
