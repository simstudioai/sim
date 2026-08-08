import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { updateKnowledgeChunkContract } from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDurableSecretProvenanceRegistry } from '@/lib/execution/durable-secret-provenance'
import { deleteChunk, updateChunk } from '@/lib/knowledge/chunks/service'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import {
  createKnowledgePersistedResponse,
  resolveKnowledgeWriteSecretProvenance,
} from '@/app/api/knowledge/secret-provenance'
import { checkChunkAccess, checkChunkWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('ChunkByIdAPI')

export const GET = withRouteHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
  ) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId, chunkId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized chunk access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkChunkAccess(knowledgeBaseId, documentId, chunkId, userId)

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted unauthorized chunk access: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      logger.info(
        `[${requestId}] Retrieved chunk: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      const responseBody = {
        success: true,
        data: accessCheck.chunk,
      }
      const workspaceId = accessCheck.knowledgeBase?.workspaceId ?? undefined
      return createKnowledgePersistedResponse({
        request: req,
        authType: auth.authType,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        body: responseBody,
        chunks: accessCheck.chunk
          ? [
              {
                id: accessCheck.chunk.id,
                documentId,
                content: accessCheck.chunk.content,
                value: accessCheck.chunk,
              },
            ]
          : [],
      })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching chunk`, error)
      return NextResponse.json({ error: 'Failed to fetch chunk' }, { status: 500 })
    }
  }
)

export const PUT = withRouteHandler(
  async (
    req: NextRequest,
    context: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
  ) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId, chunkId } = await context.params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized chunk update attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkChunkWriteAccess(knowledgeBaseId, documentId, chunkId, userId)

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted unauthorized chunk update: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (accessCheck.document?.connectorId) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to update chunk on connector-synced document: Doc=${documentId}`
        )
        return NextResponse.json(
          { error: 'Chunks from connector-synced documents are read-only' },
          { status: 403 }
        )
      }

      const parsed = await parseRequest(updateKnowledgeChunkContract, req, context)
      if (!parsed.success) return parsed.response

      const validatedData = parsed.data.body
      const workspaceId = accessCheck.knowledgeBase?.workspaceId ?? undefined
      const writeProvenance = resolveKnowledgeWriteSecretProvenance({
        request: req,
        payload: validatedData,
        authType: auth.authType,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        selectionKeys: validatedData.content === undefined ? [] : ['chunk-content'],
      })
      if (!writeProvenance.success) return writeProvenance.response
      const chunkProvenance = writeProvenance.provenances?.[0]
      if (chunkProvenance?.status === 'unknown') {
        return NextResponse.json(
          { error: 'Knowledge chunk secret provenance is unavailable' },
          { status: 400 }
        )
      }
      const registry = chunkProvenance
        ? await createDurableSecretProvenanceRegistry(chunkProvenance, {
            userId,
            ...(workspaceId ? { workspaceId } : {}),
          })
        : undefined

      const updatedChunk = await runWithKnowledgeModelInputProvenance(registry, () =>
        updateChunk(chunkId, validatedData, requestId, workspaceId, chunkProvenance)
      )

      logger.info(
        `[${requestId}] Chunk updated: ${chunkId} in document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return createKnowledgePersistedResponse({
        request: req,
        authType: auth.authType,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        body: { success: true, data: updatedChunk },
        chunks: [
          {
            id: updatedChunk.id,
            documentId,
            content: updatedChunk.content,
            value: updatedChunk,
          },
        ],
      })
    } catch (error) {
      logger.error(`[${requestId}] Error updating chunk`, error)
      return NextResponse.json({ error: 'Failed to update chunk' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string; documentId: string; chunkId: string }> }
  ) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId, documentId, chunkId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized chunk delete attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkChunkWriteAccess(
        knowledgeBaseId,
        documentId,
        chunkId,
        session.user.id
      )

      if (!accessCheck.hasAccess) {
        if (accessCheck.notFound) {
          logger.warn(
            `[${requestId}] ${accessCheck.reason}: KB=${knowledgeBaseId}, Doc=${documentId}, Chunk=${chunkId}`
          )
          return NextResponse.json({ error: accessCheck.reason }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted unauthorized chunk deletion: ${accessCheck.reason}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (accessCheck.document?.connectorId) {
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted to delete chunk on connector-synced document: Doc=${documentId}`
        )
        return NextResponse.json(
          { error: 'Chunks from connector-synced documents are read-only' },
          { status: 403 }
        )
      }

      await deleteChunk(chunkId, documentId, requestId)

      logger.info(
        `[${requestId}] Chunk deleted: ${chunkId} from document ${documentId} in knowledge base ${knowledgeBaseId}`
      )

      return NextResponse.json({
        success: true,
        data: { message: 'Chunk deleted successfully' },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error deleting chunk`, error)
      return NextResponse.json({ error: 'Failed to delete chunk' }, { status: 500 })
    }
  }
)
