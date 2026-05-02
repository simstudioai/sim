import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { saveDocumentTagDefinitionsContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { SUPPORTED_FIELD_TYPES } from '@/lib/knowledge/constants'
import {
  cleanupUnusedTagDefinitions,
  createOrUpdateTagDefinitionsBulk,
  deleteAllTagDefinitions,
  getDocumentTagDefinitions,
} from '@/lib/knowledge/tags/service'
import type { BulkTagDefinitionsData } from '@/lib/knowledge/tags/types'
import { checkDocumentAccess, checkDocumentWriteAccess } from '@/app/api/knowledge/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('DocumentTagDefinitionsAPI')

// GET /api/knowledge/[id]/documents/[documentId]/tag-definitions - Get tag definitions for a document
export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId } = await params

    try {
      logger.info(`[${requestId}] Getting tag definitions for document ${documentId}`)

      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Verify document exists and belongs to the knowledge base
      const accessCheck = await checkDocumentAccess(knowledgeBaseId, documentId, session.user.id)
      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted unauthorized document access: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const tagDefinitions = await getDocumentTagDefinitions(knowledgeBaseId)

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
)

// POST /api/knowledge/[id]/documents/[documentId]/tag-definitions - Create/update tag definitions
export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId } = await context.params

    try {
      logger.info(`[${requestId}] Creating/updating tag definitions for document ${documentId}`)

      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Verify document exists and user has write access
      const accessCheck = await checkDocumentWriteAccess(
        knowledgeBaseId,
        documentId,
        session.user.id
      )
      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted unauthorized document write access: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(saveDocumentTagDefinitionsContract, req, context)
      if (!parsed.success) return parsed.response

      const validatedData = parsed.data.body

      for (const def of validatedData.definitions) {
        /**
         * Defense-in-depth runtime check: the contract types `fieldType` as a plain
         * string because tightening to the field-type enum cascades into UI form
         * state types. Cast here to allow `includes` to accept the wider input.
         */
        if (!(SUPPORTED_FIELD_TYPES as readonly string[]).includes(def.fieldType)) {
          return NextResponse.json(
            { error: 'Invalid request data', details: `Unsupported field type: ${def.fieldType}` },
            { status: 400 }
          )
        }
      }

      const bulkData: BulkTagDefinitionsData = {
        definitions: validatedData.definitions.map((def) => ({
          tagSlot: def.tagSlot,
          displayName: def.displayName,
          fieldType: def.fieldType,
          originalDisplayName: def._originalDisplayName,
        })),
      }

      const result = await createOrUpdateTagDefinitionsBulk(knowledgeBaseId, bulkData, requestId)

      return NextResponse.json({
        success: true,
        data: {
          created: result.created,
          updated: result.updated,
          errors: result.errors,
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error creating/updating tag definitions`, error)
      return NextResponse.json(
        { error: 'Failed to create/update tag definitions' },
        { status: 500 }
      )
    }
  }
)

// DELETE /api/knowledge/[id]/documents/[documentId]/tag-definitions - Delete all tag definitions for a document
export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId } = await params
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') // 'cleanup' or 'all'

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Verify document exists and user has write access
      const accessCheck = await checkDocumentWriteAccess(
        knowledgeBaseId,
        documentId,
        session.user.id
      )
      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted unauthorized document write access: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (action === 'cleanup') {
        // Just run cleanup
        logger.info(`[${requestId}] Running cleanup for KB ${knowledgeBaseId}`)
        const cleanedUpCount = await cleanupUnusedTagDefinitions(knowledgeBaseId, requestId)

        return NextResponse.json({
          success: true,
          data: { cleanedUp: cleanedUpCount },
        })
      }
      // Delete all tag definitions (original behavior)
      logger.info(`[${requestId}] Deleting all tag definitions for KB ${knowledgeBaseId}`)

      const deletedCount = await deleteAllTagDefinitions(knowledgeBaseId, requestId)

      return NextResponse.json({
        success: true,
        message: 'Tag definitions deleted successfully',
        data: { deleted: deletedCount },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error with tag definitions operation`, error)
      return NextResponse.json({ error: 'Failed to process tag definitions' }, { status: 500 })
    }
  }
)
