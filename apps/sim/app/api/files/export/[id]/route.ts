import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { StorageContext } from '@/lib/uploads/config'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { extractEmbeddedFileRefs } from '@/lib/uploads/server/embedded-image-refs'
import {
  createMarkdownExport,
  MAX_EXPORT_MARKDOWN_PARSE_BYTES,
  MAX_EXPORT_TOTAL_BYTES,
  type MarkdownExportAsset,
  type MarkdownExportResult,
  MarkdownExportSizeError,
} from '@/lib/uploads/server/markdown-export'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import { storedFileId } from '@/lib/uploads/utils/embedded-image-ref'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

const logger = createLogger('FilesExportAPI')

const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

function isMarkdown(originalName: string, contentType: string): boolean {
  if (MARKDOWN_MIME_TYPES.has(contentType)) return true
  const ext = originalName.split('.').pop()?.toLowerCase() ?? ''
  return MARKDOWN_EXTENSIONS.has(ext)
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const parsed = await parseRequest(fileExportContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const record = await getFileMetadataById(id)
    if (!record) {
      logger.warn('File not found by ID', { id })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const knowledgeAccess = authResult.authType === AuthType.SESSION ? 'user' : undefined
    const hasAccess = await verifyFileAccess(record.key, userId, undefined, undefined, undefined, {
      knowledgeAccess,
    })
    if (!hasAccess) {
      logger.warn('Unauthorized file export attempt', { id, userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    /**
     * Records the egress only at a real success exit (serve redirect, plain
     * markdown, or bundled zip) so a mid-export failure never logs a download
     * that never happened.
     */
    const auditExport = (format: 'file' | 'markdown' | 'zip', assetCount: number) => {
      recordAudit({
        workspaceId: record.workspaceId ?? null,
        actorId: userId,
        action: AuditAction.FILE_DOWNLOADED,
        resourceType: AuditResourceType.FILE,
        resourceId: record.id,
        resourceName: record.originalName,
        description: `Exported file "${record.originalName}"`,
        metadata: {
          fileId: record.id,
          fileName: record.originalName,
          bytes: getWorkspaceFileSize(record),
          format,
          assetCount,
        },
        request,
      })
      captureServerEvent(
        userId,
        'file_downloaded',
        {
          ...(record.workspaceId ? { workspace_id: record.workspaceId } : {}),
          is_bulk: assetCount > 0,
          file_count: 1 + assetCount,
        },
        record.workspaceId ? { groups: { workspace: record.workspaceId } } : undefined
      )
    }

    if (!isMarkdown(record.originalName, record.contentType)) {
      const storagePrefix = getServeStoragePrefix()
      const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
      auditExport('file', 0)
      return NextResponse.redirect(new URL(servePath, request.url), { status: 302 })
    }

    // Capped like everything else in the bundle: the document body is usually the
    // largest single entry, so leaving it unbounded left the export limit unenforced
    // against the one item most able to exceed it. A body that alone exceeds the limit
    // is a size rejection, so it reports as one rather than as a server error.
    let mdBuffer: Buffer
    try {
      mdBuffer = await downloadFile({
        key: record.key,
        context: record.context as StorageContext,
        maxBytes: MAX_EXPORT_TOTAL_BYTES,
      })
    } catch (error) {
      if (!isPayloadSizeLimitError(error)) throw error
      return NextResponse.json(
        {
          error: `This document exceeds the ${formatFileSize(MAX_EXPORT_TOTAL_BYTES)} export limit.`,
        },
        { status: 400 }
      )
    }
    // Ids only: a serve-URL embed names a storage key, which the bundler has no id to rewrite the
    // markdown against, so those images stay pointed at their original URL.
    const imageIds =
      mdBuffer.length <= MAX_EXPORT_MARKDOWN_PARSE_BYTES
        ? extractEmbeddedFileRefs(mdBuffer.toString('utf-8')).ids
        : []

    logger.info('Exporting markdown', { id, imageCount: imageIds.length })

    // Metadata first: declared sizes bound the download before a byte is read, and the
    // authorization check costs nothing to run here.
    const assetTargets = (
      await mapWithConcurrency(imageIds, MATERIALIZE_CONCURRENCY, async (imageId) => {
        try {
          const imgRecord = await getFileMetadataById(storedFileId(imageId))
          if (!imgRecord) return null
          if (
            !(await verifyFileAccess(imgRecord.key, userId, undefined, undefined, undefined, {
              knowledgeAccess,
            }))
          ) {
            return null
          }
          return {
            imageId,
            key: imgRecord.key,
            context: imgRecord.context as StorageContext,
            originalName: imgRecord.originalName,
            size: getWorkspaceFileSize(imgRecord),
          } satisfies MarkdownExportAsset
        } catch (error) {
          logger.warn('Failed to resolve asset for export', {
            imageId,
            error: toError(error).message,
          })
          return null
        }
      })
    ).filter((target): target is NonNullable<typeof target> => target !== null)

    let exported: MarkdownExportResult
    try {
      exported = await createMarkdownExport({
        content: mdBuffer,
        fileName: record.originalName,
        assets: assetTargets,
      })
    } catch (error) {
      if (!(error instanceof MarkdownExportSizeError)) throw error
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    auditExport(exported.format, exported.assetCount)
    return new NextResponse(new Uint8Array(exported.buffer), {
      status: 200,
      headers: {
        'Content-Type': exported.contentType,
        'Content-Disposition': `attachment; ${encodeFilenameForHeader(exported.fileName)}`,
        'Content-Length': String(exported.buffer.length),
      },
    })
  }
)
