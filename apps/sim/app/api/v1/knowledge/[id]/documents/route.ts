import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import {
  createSingleDocument,
  type DocumentData,
  getDocuments,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { validateFileType } from '@/lib/uploads/utils/validation'
import {
  authenticateRequest,
  handleError,
  resolveKnowledgeBase,
  serializeDate,
  validateSchema,
} from '@/app/api/v1/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

interface DocumentsRouteParams {
  params: Promise<{ id: string }>
}

const ListDocumentsSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  enabledFilter: z.enum(['all', 'enabled', 'disabled']).default('all'),
  sortBy: z
    .enum([
      'filename',
      'fileSize',
      'tokenCount',
      'chunkCount',
      'uploadedAt',
      'processingStatus',
      'enabled',
    ])
    .default('uploadedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

/** GET /api/v1/knowledge/[id]/documents — List documents in a knowledge base. */
export async function GET(request: NextRequest, { params }: DocumentsRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id: knowledgeBaseId } = await params
    const { searchParams } = new URL(request.url)

    const validation = validateSchema(ListDocumentsSchema, {
      workspaceId: searchParams.get('workspaceId'),
      limit: searchParams.get('limit') ?? undefined,
      offset: searchParams.get('offset') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      enabledFilter: searchParams.get('enabledFilter') ?? undefined,
      sortBy: searchParams.get('sortBy') ?? undefined,
      sortOrder: searchParams.get('sortOrder') ?? undefined,
    })
    if (!validation.success) return validation.response

    const { workspaceId, limit, offset, search, enabledFilter, sortBy, sortOrder } = validation.data

    const result = await resolveKnowledgeBase(knowledgeBaseId, workspaceId, userId, rateLimit)
    if (result instanceof NextResponse) return result

    const documentsResult = await getDocuments(
      knowledgeBaseId,
      {
        enabledFilter: enabledFilter === 'all' ? undefined : enabledFilter,
        search,
        limit,
        offset,
        sortBy: sortBy as DocumentSortField,
        sortOrder: sortOrder as SortOrder,
      },
      requestId
    )

    return NextResponse.json({
      success: true,
      data: {
        documents: documentsResult.documents.map((doc) => ({
          id: doc.id,
          knowledgeBaseId,
          filename: doc.filename,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          processingStatus: doc.processingStatus,
          chunkCount: doc.chunkCount,
          tokenCount: doc.tokenCount,
          characterCount: doc.characterCount,
          enabled: doc.enabled,
          createdAt: serializeDate(doc.uploadedAt),
        })),
        pagination: documentsResult.pagination,
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to list documents')
  }
}

/** POST /api/v1/knowledge/[id]/documents — Upload a document to a knowledge base. */
export async function POST(request: NextRequest, { params }: DocumentsRouteParams) {
  const auth = await authenticateRequest(request, 'knowledge-detail')
  if (auth instanceof NextResponse) return auth
  const { requestId, userId, rateLimit } = auth

  try {
    const { id: knowledgeBaseId } = await params

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid multipart form data' },
        { status: 400 }
      )
    }

    const rawFile = formData.get('file')
    const file = rawFile instanceof File ? rawFile : null
    const rawWorkspaceId = formData.get('workspaceId')
    const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : null

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId form field is required' }, { status: 400 })
    }

    if (!file) {
      return NextResponse.json({ error: 'file form field is required' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
        },
        { status: 413 }
      )
    }

    const fileTypeError = validateFileType(file.name, file.type || '')
    if (fileTypeError) {
      return NextResponse.json({ error: fileTypeError.message }, { status: 415 })
    }

    const result = await resolveKnowledgeBase(
      knowledgeBaseId,
      workspaceId,
      userId,
      rateLimit,
      'write'
    )
    if (result instanceof NextResponse) return result

    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = file.type || 'application/octet-stream'

    const uploadedFile = await uploadWorkspaceFile(
      workspaceId,
      userId,
      buffer,
      file.name,
      contentType
    )

    const newDocument = await createSingleDocument(
      {
        filename: file.name,
        fileUrl: uploadedFile.url,
        fileSize: file.size,
        mimeType: contentType,
      },
      knowledgeBaseId,
      requestId
    )

    const documentData: DocumentData = {
      documentId: newDocument.id,
      filename: file.name,
      fileUrl: uploadedFile.url,
      fileSize: file.size,
      mimeType: contentType,
    }

    processDocumentsWithQueue([documentData], knowledgeBaseId, {}, requestId).catch(() => {
      // Processing errors are logged internally
    })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.DOCUMENT_UPLOADED,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: newDocument.id,
      resourceName: file.name,
      description: `Uploaded document "${file.name}" to knowledge base via API`,
      metadata: { knowledgeBaseId, fileSize: file.size, mimeType: contentType },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        document: {
          id: newDocument.id,
          knowledgeBaseId,
          filename: newDocument.filename,
          fileSize: newDocument.fileSize,
          mimeType: newDocument.mimeType,
          processingStatus: 'pending',
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
          enabled: newDocument.enabled,
          createdAt: serializeDate(newDocument.uploadedAt),
        },
        message: 'Document uploaded successfully. Processing will begin shortly.',
      },
    })
  } catch (error) {
    return handleError(requestId, error, 'Failed to upload document')
  }
}
