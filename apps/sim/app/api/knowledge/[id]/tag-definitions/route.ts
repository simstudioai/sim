import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { createTagDefinitionContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { SUPPORTED_FIELD_TYPES } from '@/lib/knowledge/constants'
import { createTagDefinition, getTagDefinitions } from '@/lib/knowledge/tags/service'
import { checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('KnowledgeBaseTagDefinitionsAPI')

// GET /api/knowledge/[id]/tag-definitions - Get all tag definitions for a knowledge base
export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      logger.info(`[${requestId}] Getting tag definitions for knowledge base ${knowledgeBaseId}`)

      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      // For session auth, verify KB access. Internal JWT is trusted.
      if (auth.authType === AuthType.SESSION && auth.userId) {
        const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
        if (!accessCheck.hasAccess) {
          return NextResponse.json(
            { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
            { status: accessCheck.notFound ? 404 : 403 }
          )
        }
      }

      const tagDefinitions = await getTagDefinitions(knowledgeBaseId)

      logger.info(
        `[${requestId}] Retrieved ${tagDefinitions.length} tag definitions (${auth.authType})`
      )

      return NextResponse.json({
        success: true,
        data: tagDefinitions,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error getting tag definitions`, error)
      return NextResponse.json({ error: 'Failed to get tag definitions' }, { status: 500 })
    }
  }
)

// POST /api/knowledge/[id]/tag-definitions - Create a new tag definition
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await context.params

    try {
      logger.info(`[${requestId}] Creating tag definition for knowledge base ${knowledgeBaseId}`)

      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      // For session auth, verify KB access. Internal JWT is trusted.
      if (auth.authType === AuthType.SESSION && auth.userId) {
        const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
        if (!accessCheck.hasAccess) {
          return NextResponse.json(
            { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
            { status: accessCheck.notFound ? 404 : 403 }
          )
        }
      }

      const parsed = await parseRequest(createTagDefinitionContract, req, context)
      if (!parsed.success) return parsed.response

      const validatedData = parsed.data.body
      if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(validatedData.fieldType)) {
        return NextResponse.json(
          { error: 'Invalid request data', details: 'Invalid field type' },
          { status: 400 }
        )
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
)
