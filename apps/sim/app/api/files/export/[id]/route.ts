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
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import type { StorageContext } from '@/lib/uploads/config'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

const logger = createLogger('FilesExportAPI')

/**
 * Bundling caps. The embed list comes from scanning the document body, so its length
 * and the bytes behind it are whatever the author put there — without these the export
 * would materialize an unbounded number of unbounded assets in one request.
 *
 * The byte ceilings are the real bound and match the bulk-download route, so the two
 * export surfaces reject at the same size. The count is only a guard on the metadata
 * lookups that precede the byte check, so it sits far above any hand-authored document
 * rather than at a number a screenshot-heavy doc could plausibly reach.
 */
const MAX_EXPORT_ASSETS = 500
const MAX_EXPORT_ASSET_BYTES = 25 * 1024 * 1024
const MAX_EXPORT_TOTAL_BYTES = 250 * 1024 * 1024

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

    if (!isMarkdown(record.originalName, record.contentType)) {
      const storagePrefix = getServeStoragePrefix()
      const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
      auditExport('file', 0)
      return NextResponse.redirect(new URL(servePath, request.url), { status: 302 })
    }

    const mdBuffer = await downloadFile({
      key: record.key,
      context: record.context as StorageContext,
    })
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

    if (imageIds.length > MAX_EXPORT_ASSETS) {
      return NextResponse.json(
        {
          error: `This document embeds ${imageIds.length} files, more than the ${MAX_EXPORT_ASSETS} an export can bundle.`,
        },
        { status: 400 }
      )
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

    const declaredAssetBytes = assetTargets.reduce((sum, target) => sum + target.record.size, 0)
    if (declaredAssetBytes > MAX_EXPORT_TOTAL_BYTES) {
      return NextResponse.json(
        {
          error: `Embedded files total ${formatFileSize(declaredAssetBytes)}, which exceeds the ${formatFileSize(MAX_EXPORT_TOTAL_BYTES)} export limit.`,
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
