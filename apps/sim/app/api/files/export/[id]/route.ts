import { basename } from 'node:path'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { StorageContext } from '@/lib/uploads/config'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { extractEmbeddedFileRefs } from '@/lib/uploads/server/embedded-image-refs'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
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

const MAX_PDF_MARKDOWN_BYTES = 256 * 1024
const MAX_PDF_ASSET_BYTES = 10 * 1024 * 1024
const MAX_PDF_TOTAL_SOURCE_BYTES = 50 * 1024 * 1024
const PDF_EXPORT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 3,
  refillRate: 3,
  refillIntervalMs: 60_000,
}

const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

function isMarkdown(originalName: string, contentType: string): boolean {
  if (MARKDOWN_MIME_TYPES.has(contentType)) return true
  const ext = originalName.split('.').pop()?.toLowerCase() ?? ''
  return MARKDOWN_EXTENSIONS.has(ext)
}

function safePdfFilename(name: string): string {
  return basename(name)
    .replace(/["\\]/g, '_')
    .replace(/[\r\n\t]/g, '')
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const parsed = await parseRequest(fileExportContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { format } = parsed.data.query

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
    const hasAccess = await verifyFileAccess(record.key, userId, undefined, undefined, {
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

    const auditPdfExport = (assetCount: number) => {
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
          format: 'pdf',
          assetCount,
        },
        request,
      })
      captureServerEvent(
        userId,
        'file_downloaded',
        {
          ...(record.workspaceId ? { workspace_id: record.workspaceId } : {}),
          is_bulk: false,
          file_count: 1,
        },
        record.workspaceId ? { groups: { workspace: record.workspaceId } } : undefined
      )
    }

    if (format === 'pdf') {
      if (!isMarkdown(record.originalName, record.contentType)) {
        return NextResponse.json(
          { error: 'PDF export is only available for Markdown files.' },
          { status: 400 }
        )
      }

      const rateLimited = await enforceUserRateLimit(
        'markdown-pdf-export',
        userId,
        PDF_EXPORT_RATE_LIMIT
      )
      if (rateLimited) return rateLimited

      let mdBuffer: Buffer
      try {
        mdBuffer = await downloadFile({
          key: record.key,
          context: record.context as StorageContext,
          maxBytes: MAX_PDF_MARKDOWN_BYTES,
        })
      } catch (error) {
        if (!isPayloadSizeLimitError(error)) throw error
        return NextResponse.json(
          {
            error: `This document exceeds the ${formatFileSize(MAX_PDF_MARKDOWN_BYTES)} PDF export limit.`,
          },
          { status: 400 }
        )
      }

      const mdContent = mdBuffer.toString('utf-8')
      const { keys: imageKeys, ids: imageIds } = extractEmbeddedFileRefs(mdContent)
      const imageRefs: Array<{ key: string } | { fileId: string }> = [
        ...imageKeys.map((key) => ({ key })),
        ...imageIds.map((fileId) => ({ fileId })),
      ]
      const { MarkdownPdfLimitError, markdownPdfImageKey, renderMarkdownPdf } = await import(
        '@/app/api/files/export/[id]/markdown-pdf'
      )
      const images = new Map<string, Buffer>()
      let sourceBytes = mdBuffer.length

      if (record.workspaceId) {
        for (const imageRef of imageRefs) {
          try {
            const image = await resolveWorkspaceInlineImage(
              record.workspaceId,
              'fileId' in imageRef ? { fileId: storedFileId(imageRef.fileId) } : imageRef
            )
            if (!image || !(await verifyFileAccess(image.key, userId))) continue

            const buffer = await downloadFile({
              key: image.key,
              context: 'workspace',
              maxBytes: MAX_PDF_ASSET_BYTES,
            })
            if (sourceBytes + buffer.length > MAX_PDF_TOTAL_SOURCE_BYTES) {
              return NextResponse.json(
                {
                  error: `This document and its embedded files exceed the ${formatFileSize(MAX_PDF_TOTAL_SOURCE_BYTES)} PDF export limit.`,
                },
                { status: 400 }
              )
            }

            sourceBytes += buffer.length
            images.set(markdownPdfImageKey(imageRef), buffer)
          } catch (error) {
            logger.warn('Failed to fetch asset for PDF export', {
              imageRef: markdownPdfImageKey(imageRef),
              error: toError(error).message,
            })
          }
        }
      }

      const title = record.originalName.replace(/\.(?:md|markdown)$/i, '')
      const pdfName = safePdfFilename(`${title}.pdf`)
      let pdfBuffer: Buffer
      try {
        pdfBuffer = await renderMarkdownPdf({ markdown: mdContent, title, images })
      } catch (error) {
        if (error instanceof MarkdownPdfLimitError) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }

      auditPdfExport(images.size)
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; ${encodeFilenameForHeader(pdfName)}`,
          'Content-Length': String(pdfBuffer.length),
        },
      })
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
            !(await verifyFileAccess(imgRecord.key, userId, undefined, undefined, {
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
