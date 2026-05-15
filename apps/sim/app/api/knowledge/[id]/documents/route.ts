import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import {
  bulkKnowledgeDocumentsContract,
  createKnowledgeDocumentsContract,
  listKnowledgeDocumentsQuerySchema,
} from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  bulkDocumentOperation,
  bulkDocumentOperationByFilter,
  createDocumentRecords,
  createSingleDocument,
  getDocuments,
  getProcessingConfig,
  processDocumentsWithQueue,
  type TagFilterCondition,
} from '@/lib/knowledge/documents/service'
import { captureServerEvent } from '@/lib/posthog/server'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentsAPI')

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized documents access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, session.user.id)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted to access unauthorized knowledge base documents ${knowledgeBaseId}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const queryResult = listKnowledgeDocumentsQuerySchema.safeParse(
        Object.fromEntries(new URL(req.url).searchParams.entries())
      )
      if (!queryResult.success) {
        return NextResponse.json(
          { error: 'Invalid query parameters', details: queryResult.error.issues },
          { status: 400 }
        )
      }
      const { enabledFilter, search, limit, offset, sortBy, sortOrder, tagFilters } =
        queryResult.data

      const result = await getDocuments(
        knowledgeBaseId,
        {
          enabledFilter: enabledFilter || undefined,
          search,
          limit,
          offset,
          ...(sortBy && { sortBy }),
          ...(sortOrder && { sortOrder }),
          tagFilters: tagFilters as TagFilterCondition[] | undefined,
        },
        requestId
      )

      return NextResponse.json({
        success: true,
        data: {
          documents: result.documents,
          pagination: result.pagination,
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error fetching documents`, error)
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
    }
  }
)

export const POST = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Authentication failed: ${auth.error || 'Unauthorized'}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const parsed = await parseRequest(
        createKnowledgeDocumentsContract,
        req,
        { params },
        {
          validationErrorResponse: (error) => {
            logger.warn(`[${requestId}] Invalid document creation request`, {
              errors: error.issues,
            })
            return NextResponse.json(
              { error: 'Invalid request data', details: error.issues },
              { status: 400 }
            )
          },
        }
      )
      if (!parsed.success) return parsed.response
      const body = parsed.data.body
      const workflowId = body.workflowId

      logger.info(`[${requestId}] Knowledge base document creation request`, {
        knowledgeBaseId,
        workflowId,
        hasWorkflowId: !!workflowId,
        bulk: body.bulk === true,
      })

      if (workflowId) {
        const authorization = await authorizeWorkflowByWorkspacePermission({
          workflowId,
          userId,
          action: 'write',
        })
        if (!authorization.allowed) {
          return NextResponse.json(
            { error: authorization.message || 'Access denied' },
            { status: authorization.status }
          )
        }
      }

      const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, userId)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted to create document in unauthorized knowledge base ${knowledgeBaseId}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const kbWorkspaceId = accessCheck.knowledgeBase?.workspaceId

      if (body.bulk === true) {
        const createdDocuments = await createDocumentRecords(
          body.documents,
          knowledgeBaseId,
          requestId
        )

        logger.info(
          `[${requestId}] Starting controlled async processing of ${createdDocuments.length} documents`
        )

        try {
          const { PlatformEvents } = await import('@/lib/core/telemetry')
          PlatformEvents.knowledgeBaseDocumentsUploaded({
            knowledgeBaseId,
            documentsCount: createdDocuments.length,
            uploadType: 'bulk',
            recipe: body.processingOptions?.recipe,
          })
        } catch (_e) {
          // Silently fail
        }

        captureServerEvent(
          userId,
          'knowledge_base_document_uploaded',
          {
            knowledge_base_id: knowledgeBaseId,
            workspace_id: kbWorkspaceId ?? '',
            document_count: createdDocuments.length,
            upload_type: 'bulk',
          },
          {
            ...(kbWorkspaceId ? { groups: { workspace: kbWorkspaceId } } : {}),
            setOnce: { first_document_uploaded_at: new Date().toISOString() },
          }
        )

        processDocumentsWithQueue(
          createdDocuments,
          knowledgeBaseId,
          body.processingOptions ?? {},
          requestId
        ).catch((error: unknown) => {
          logger.error(`[${requestId}] Critical error in document processing pipeline:`, error)
        })

        recordAudit({
          workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
          actorId: userId,
          actorName: auth.userName,
          actorEmail: auth.userEmail,
          action: AuditAction.DOCUMENT_UPLOADED,
          resourceType: AuditResourceType.DOCUMENT,
          resourceId: knowledgeBaseId,
          resourceName: `${createdDocuments.length} document(s)`,
          description: `Uploaded ${createdDocuments.length} document(s) to knowledge base "${knowledgeBaseId}"`,
          metadata: {
            knowledgeBaseName: accessCheck.knowledgeBase?.name,
            fileCount: createdDocuments.length,
          },
          request: req,
        })

        return NextResponse.json({
          success: true,
          data: {
            total: createdDocuments.length,
            documentsCreated: createdDocuments.map((doc) => ({
              documentId: doc.documentId,
              filename: doc.filename,
              status: 'pending',
            })),
            processingMethod: 'background',
            processingConfig: {
              maxConcurrentDocuments: getProcessingConfig().maxConcurrentDocuments,
              batchSize: getProcessingConfig().batchSize,
              totalBatches: Math.ceil(createdDocuments.length / getProcessingConfig().batchSize),
            },
          },
        })
      }

      const { bulk: _bulk, workflowId: _workflowId, ...singleDocumentData } = body
      const newDocument = await createSingleDocument(singleDocumentData, knowledgeBaseId, requestId)

      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')
        PlatformEvents.knowledgeBaseDocumentsUploaded({
          knowledgeBaseId,
          documentsCount: 1,
          uploadType: 'single',
          mimeType: singleDocumentData.mimeType,
          fileSize: singleDocumentData.fileSize,
        })
      } catch (_e) {
        // Silently fail
      }

      captureServerEvent(
        userId,
        'knowledge_base_document_uploaded',
        {
          knowledge_base_id: knowledgeBaseId,
          workspace_id: kbWorkspaceId ?? '',
          document_count: 1,
          upload_type: 'single',
        },
        {
          ...(kbWorkspaceId ? { groups: { workspace: kbWorkspaceId } } : {}),
          setOnce: { first_document_uploaded_at: new Date().toISOString() },
        }
      )

      recordAudit({
        workspaceId: accessCheck.knowledgeBase?.workspaceId ?? null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.DOCUMENT_UPLOADED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: knowledgeBaseId,
        resourceName: singleDocumentData.filename,
        description: `Uploaded document "${singleDocumentData.filename}" to knowledge base "${knowledgeBaseId}"`,
        metadata: {
          knowledgeBaseName: accessCheck.knowledgeBase?.name,
          fileName: singleDocumentData.filename,
          fileType: singleDocumentData.mimeType,
          fileSize: singleDocumentData.fileSize,
        },
        request: req,
      })

      return NextResponse.json({
        success: true,
        data: newDocument,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error creating document`, error)

      const errorMessage = getErrorMessage(error, 'Failed to create document')
      const isStorageLimitError =
        errorMessage.includes('Storage limit exceeded') || errorMessage.includes('storage limit')
      const isMissingKnowledgeBase = errorMessage === 'Knowledge base not found'

      return NextResponse.json(
        { error: errorMessage },
        { status: isMissingKnowledgeBase ? 404 : isStorageLimitError ? 413 : 500 }
      )
    }
  }
)

export const PATCH = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthorized bulk document operation attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const accessCheck = await checkKnowledgeBaseWriteAccess(knowledgeBaseId, session.user.id)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted to perform bulk operation on unauthorized knowledge base ${knowledgeBaseId}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(
        bulkKnowledgeDocumentsContract,
        req,
        { params },
        {
          validationErrorResponse: (error) => {
            logger.warn(`[${requestId}] Invalid bulk operation data`, { errors: error.issues })
            return NextResponse.json(
              { error: 'Invalid request data', details: error.issues },
              { status: 400 }
            )
          },
        }
      )
      if (!parsed.success) return parsed.response
      const validatedData = parsed.data.body
      const { operation, documentIds, selectAll, enabledFilter } = validatedData

      try {
        let result
        if (selectAll) {
          result = await bulkDocumentOperationByFilter(
            knowledgeBaseId,
            operation,
            enabledFilter,
            requestId
          )
        } else if (documentIds && documentIds.length > 0) {
          result = await bulkDocumentOperation(knowledgeBaseId, operation, documentIds, requestId)
        } else {
          return NextResponse.json({ error: 'No documents specified' }, { status: 400 })
        }

        return NextResponse.json({
          success: true,
          data: {
            operation,
            successCount: result.successCount,
            updatedDocuments: result.updatedDocuments,
          },
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'No valid documents found to update') {
          return NextResponse.json({ error: 'No valid documents found to update' }, { status: 404 })
        }
        throw error
      }
    } catch (error) {
      logger.error(`[${requestId}] Error in bulk document operation`, error)
      return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 })
    }
  }
)
