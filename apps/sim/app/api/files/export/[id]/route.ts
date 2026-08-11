import path from 'node:path'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { extractEmbeddedImageIds } from '@/lib/copilot/tools/server/files/embedded-image-refs'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { StorageContext } from '@/lib/uploads/config'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { extractEmbeddedFileRefs } from '@/lib/uploads/utils/embedded-image-ref'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

const logger = createLogger('FilesExportAPI')

/**
 * Byte ceilings for a bundled export. The bytes behind an embed list are whatever the
 * author put there, so without these the export would materialize unbounded assets in
 * one request. They match the bulk-download route, so the two export surfaces reject at
 * the same size.
 *
 * There is deliberately no count cap here: `extractEmbeddedFileRefs` already stops at
 * `MAX_EMBEDDED_IMAGES`, so the list this route receives is bounded before it arrives.
 */
const MAX_EXPORT_ASSET_BYTES = 25 * 1024 * 1024
const MAX_EXPORT_TOTAL_BYTES = 250 * 1024 * 1024

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

function safeFilename(name: string): string {
  return path
    .basename(name)
    .replace(/["\\]/g, '_')
    .replace(/[\r\n\t]/g, '')
}

function deduplicatedFilename(preferred: string, existing: Set<string>, imageId: string): string {
  if (!existing.has(preferred)) return preferred
  const ext = path.extname(preferred)
  const base = path.basename(preferred, ext)
  const short = `${base}_${imageId.slice(0, 8)}${ext}`
  if (!existing.has(short)) return short
  return `${base}_${imageId}${ext}`
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

    const hasAccess = await verifyFileAccess(record.key, userId)
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
          bytes: record.size,
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
          bytes: record.size,
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
            const image = await resolveWorkspaceInlineImage(record.workspaceId, imageRef)
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
      const pdfName = safeFilename(`${title}.pdf`)
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
    let mdContent = mdBuffer.toString('utf-8')

    const imageIds = extractEmbeddedImageIds(mdContent)

    logger.info('Exporting markdown', { id, imageCount: imageIds.length })

    if (imageIds.length === 0) {
      const mdName = safeFilename(record.originalName)
      const mdBytes = Buffer.from(mdContent, 'utf-8')
      auditExport('markdown', 0)
      return new NextResponse(new Uint8Array(mdBytes), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; ${encodeFilenameForHeader(mdName)}`,
          'Content-Length': String(mdBytes.length),
        },
      })
    }

    // Metadata first: declared sizes bound the download before a byte is read, and the
    // authorization check costs nothing to run here.
    const assetTargets = (
      await mapWithConcurrency(imageIds, MATERIALIZE_CONCURRENCY, async (imageId) => {
        try {
          const imgRecord = await getFileMetadataById(imageId)
          if (!imgRecord) return null
          if (!(await verifyFileAccess(imgRecord.key, userId))) return null
          return { imageId, record: imgRecord }
        } catch (error) {
          logger.warn('Failed to resolve asset for export', {
            imageId,
            error: toError(error).message,
          })
          return null
        }
      })
    ).filter((target): target is NonNullable<typeof target> => target !== null)

    // The body counts against the same budget as its assets — the zip holds both, so a
    // limit that measured only the attachments would not describe the archive produced.
    const bundleBytes =
      mdBuffer.length + assetTargets.reduce((sum, target) => sum + target.record.size, 0)
    if (bundleBytes > MAX_EXPORT_TOTAL_BYTES) {
      return NextResponse.json(
        {
          error: `This document and its embedded files total ${formatFileSize(bundleBytes)}, which exceeds the ${formatFileSize(MAX_EXPORT_TOTAL_BYTES)} export limit.`,
        },
        { status: 400 }
      )
    }

    const fetched = await mapWithConcurrency(
      assetTargets,
      MATERIALIZE_CONCURRENCY,
      async ({ imageId, record: imgRecord }) => {
        try {
          const buffer = await downloadFile({
            key: imgRecord.key,
            context: imgRecord.context as StorageContext,
            maxBytes: MAX_EXPORT_ASSET_BYTES,
          })
          return { imageId, originalName: imgRecord.originalName, buffer }
        } catch (error) {
          // A single unreadable or oversized asset drops out of the bundle rather than
          // failing the whole export; the markdown keeps its original link.
          logger.warn('Failed to fetch asset for export', {
            imageId,
            error: toError(error).message,
          })
          return null
        }
      }
    )

    const assetMap = new Map<string, { filename: string; buffer: Buffer }>()
    const usedFilenames = new Set<string>()

    for (const result of fetched) {
      if (!result) continue
      const { imageId, originalName, buffer } = result
      const preferred = safeFilename(originalName)
      const filename = deduplicatedFilename(preferred, usedFilenames, imageId)
      usedFilenames.add(filename)
      assetMap.set(imageId, { filename, buffer })
    }

    for (const [imageId, asset] of assetMap) {
      const escapedId = imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const replacement = `./assets/${asset.filename}`
      // Rewrite both embed spellings the extractor resolves to this id — the view URL and the in-app
      // `/workspace/<ws>/files/<id>` path — so a bundled asset never leaves a broken link in the export.
      mdContent = mdContent
        .replace(new RegExp(`/api/files/view/${escapedId}`, 'g'), () => replacement)
        .replace(new RegExp(`/workspace/[A-Za-z0-9-]+/files/${escapedId}`, 'g'), () => replacement)
    }

    const zip = new JSZip()
    zip.file(safeFilename(record.originalName), mdContent)
    const assetsFolder = zip.folder('assets')!
    for (const { filename, buffer } of assetMap.values()) {
      assetsFolder.file(filename, buffer)
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const zipName = safeFilename(`${record.originalName.replace(/\.[^.]+$/, '')}.zip`)

    auditExport('zip', assetMap.size)
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; ${encodeFilenameForHeader(zipName)}`,
        'Content-Length': String(zipBuffer.length),
      },
    })
  }
)
