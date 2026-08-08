import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { createTagDefinitionContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isValidSlotForFieldType } from '@/lib/knowledge/constants'
import { createTagDefinition, getTagDefinitions } from '@/lib/knowledge/tags/service'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('KnowledgeBaseTagDefinitionsAPI')

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      logger.info(`[${requestId}] Getting tag definitions for knowledge base ${knowledgeBaseId}`)

      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, auth.userId)
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
          { status: accessCheck.notFound ? 404 : 403 }
        )
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

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await context.params

    try {
      logger.info(`[${requestId}] Creating tag definition for knowledge base ${knowledgeBaseId}`)

      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, auth.userId)
      if (!accessCheck.hasAccess) {
        return NextResponse.json(
          { error: accessCheck.notFound ? 'Not found' : 'Forbidden' },
          { status: accessCheck.notFound ? 404 : 403 }
        )
      }

      const parsed = await parseRequest(createTagDefinitionContract, req, context)
      if (!parsed.success) return parsed.response

      const validatedData = parsed.data.body
      /**
       * The contract types `tagSlot` and `fieldType` as plain strings because
       * tightening them to enums cascades into UI form state types, so the pair is
       * checked here. Nothing downstream enforces it: the slot column is `text`
       * (its Drizzle `enum` is types-only) and the service casts before inserting.
       */
      if (!isValidSlotForFieldType(validatedData.tagSlot, validatedData.fieldType)) {
        return NextResponse.json(
          {
            error: 'Invalid request data',
            details: `Tag slot "${validatedData.tagSlot}" is not valid for field type "${validatedData.fieldType}"`,
          },
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
