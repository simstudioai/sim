import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import {
  bulkKnowledgeDocumentsContract,
  createKnowledgeDocumentsContract,
  listKnowledgeDocumentsQuerySchema,
  parseDocumentTagFiltersParam,
} from '@/lib/api/contracts/knowledge'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  checkAttributedUsageLimits,
  requireBillingAttributionHeader,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  messageForOrchestrationError,
  statusForOrchestrationError,
} from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  bulkDocumentOperation,
  bulkDocumentOperationByFilter,
  getDocuments,
  getProcessingConfig,
} from '@/lib/knowledge/documents/service'
import type { TagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import {
  performUploadKnowledgeDocument,
  performUploadKnowledgeDocuments,
} from '@/lib/knowledge/orchestration'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import {
  createKnowledgePersistedResponse,
  createKnowledgeProvenanceResponse,
  resolveKnowledgeDocumentWriteSecretProvenance,
} from '@/app/api/knowledge/secret-provenance'
import { checkKnowledgeBaseAccess, checkKnowledgeBaseWriteAccess } from '@/app/api/knowledge/utils'

const logger = createLogger('DocumentsAPI')

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateId().slice(0, 8)
    const { id: knowledgeBaseId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized documents access attempt`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const accessCheck = await checkKnowledgeBaseAccess(knowledgeBaseId, userId)

      if (!accessCheck.hasAccess) {
        if ('notFound' in accessCheck && accessCheck.notFound) {
          logger.warn(`[${requestId}] Knowledge base not found: ${knowledgeBaseId}`)
          return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
        }
        logger.warn(
          `[${requestId}] User ${userId} attempted to access unauthorized knowledge base documents ${knowledgeBaseId}`
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

      let parsedTagFilters: TagFilterCondition[] | undefined
      try {
        parsedTagFilters = parseDocumentTagFiltersParam(tagFilters) as
          | TagFilterCondition[]
          | undefined
      } catch {
        return NextResponse.json(
          { error: 'tagFilters must be a valid JSON array' },
          { status: 400 }
        )
      }

      const result = await getDocuments(
        knowledgeBaseId,
        {
          enabledFilter: enabledFilter || undefined,
          search,
          limit,
          offset,
          ...(sortBy && { sortBy }),
          ...(sortOrder && { sortOrder }),
          tagFilters: parsedTagFilters,
        },
        requestId
      )

      const responseBody = {
        success: true,
        data: {
          documents: result.documents,
          pagination: result.pagination,
        },
      }
      const workspaceId = accessCheck.knowledgeBase?.workspaceId ?? undefined
      return createKnowledgePersistedResponse({
        request: req,
        authType: auth.authType,
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        body: responseBody,
        documents: result.documents.map((item) => ({
          id: item.id,
          source: createKnowledgeDocumentSourceValue(item),
          value: item,
        })),
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
      const billingAttribution = kbWorkspaceId
        ? auth.authType === AuthType.INTERNAL_JWT
          ? requireBillingAttributionHeader(req.headers, {
              actorUserId: userId,
              workspaceId: kbWorkspaceId,
            })
          : await resolveBillingAttribution({
              actorUserId: userId,
              workspaceId: kbWorkspaceId,
            })
        : undefined

      /**
       * Gate the workspace payer and uploader before accepting indexing work.
       * Legacy workspace-less KBs retain account-only enforcement; asynchronous
       * connector, cron, and retry paths apply the same backstop.
       */
      const usage = billingAttribution
        ? await checkAttributedUsageLimits(billingAttribution)
        : await checkActorUsageLimits(userId)
      if (usage.isExceeded) {
        return NextResponse.json(
          {
            error: usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          },
          { status: 402 }
        )
      }

      const provenanceDocuments = body.bulk === true ? body.documents : [body]
      const writeProvenance = resolveKnowledgeDocumentWriteSecretProvenance({
        request: req,
        payload: body,
        authType: auth.authType,
        userId,
        ...(kbWorkspaceId ? { workspaceId: kbWorkspaceId } : {}),
        documents: provenanceDocuments,
      })
      if (!writeProvenance.success) return writeProvenance.response

      const knowledgeBase = {
        id: knowledgeBaseId,
        name: accessCheck.knowledgeBase?.name,
        workspaceId: kbWorkspaceId ?? null,
      }
      const actor = {
        userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        source: 'ui' as const,
        requestId,
        request: req,
      }

      if (body.bulk === true) {
        const outcome = await performUploadKnowledgeDocuments({
          ...actor,
          knowledgeBase,
          documents: body.documents,
          processingOptions: body.processingOptions,
          billingAttribution,
          secretProvenances: writeProvenance.provenances,
        })
        if (!outcome.success) {
          return NextResponse.json(
            { error: messageForOrchestrationError(outcome, 'Failed to create document') },
            { status: statusForOrchestrationError(outcome.errorCode) }
          )
        }

        const { batchSize, maxConcurrentDocuments } = getProcessingConfig()
        return createKnowledgeProvenanceResponse({
          request: req,
          authType: auth.authType,
          userId,
          ...(kbWorkspaceId ? { workspaceId: kbWorkspaceId } : {}),
          provenances:
            writeProvenance.provenances?.flatMap((provenance) => [
              provenance.filename,
              ...provenance.tags.map((tag) => tag.provenance),
            ]) ?? [],
          body: {
            success: true,
            data: {
              total: outcome.documents.length,
              documentsCreated: outcome.documents.map((doc) => ({
                documentId: doc.documentId,
                filename: doc.filename,
                status: 'pending',
              })),
              processingMethod: 'background',
              processingConfig: {
                maxConcurrentDocuments,
                batchSize,
                totalBatches: Math.ceil(outcome.documents.length / batchSize),
              },
            },
          },
        })
      }

      const { bulk: _bulk, workflowId: _workflowId, ...singleDocumentData } = body
      // Indexing is deliberately not started here: this path only records the
      // document, and its caller drives processing separately.
      const outcome = await performUploadKnowledgeDocument({
        ...actor,
        knowledgeBase,
        document: singleDocumentData,
        billingAttribution,
        secretProvenance: writeProvenance.provenances?.[0],
      })
      if (!outcome.success) {
        return NextResponse.json(
          { error: messageForOrchestrationError(outcome, 'Failed to create document') },
          { status: statusForOrchestrationError(outcome.errorCode) }
        )
      }

      return createKnowledgeProvenanceResponse({
        request: req,
        authType: auth.authType,
        userId,
        ...(kbWorkspaceId ? { workspaceId: kbWorkspaceId } : {}),
        provenances:
          writeProvenance.provenances?.flatMap((provenance) => [
            provenance.filename,
            ...provenance.tags.map((tag) => tag.provenance),
          ]) ?? [],
        body: { success: true, data: outcome.document },
      })
    } catch (error) {
      logger.error(`[${requestId}] Error creating document`, error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to create document') },
        { status: 500 }
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
