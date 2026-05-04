import path from 'node:path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { StorageContext } from '@/lib/uploads/config'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { verifyFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('FilesExportAPI')

const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])
const VIEW_URL_RE =
  /\/api\/files\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
const MAX_EMBEDDED_IMAGES = 50

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

    if (!isMarkdown(record.originalName, record.contentType)) {
      const storagePrefix = USE_BLOB_STORAGE ? 'blob' : 's3'
      const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
      return NextResponse.redirect(new URL(servePath, request.url), { status: 302 })
    }

    const mdBuffer = await downloadFile({
      key: record.key,
      context: record.context as StorageContext,
    })
    let mdContent = mdBuffer.toString('utf-8')

    const imageIds = [...new Set([...mdContent.matchAll(VIEW_URL_RE)].map((m) => m[1]))].slice(
      0,
      MAX_EMBEDDED_IMAGES
    )

    logger.info('Exporting markdown with embedded images', { id, imageCount: imageIds.length })

    const fetchResults = await Promise.allSettled(
      imageIds.map(async (imageId) => {
        const imgRecord = await getFileMetadataById(imageId)
        if (!imgRecord) return null
        const imgHasAccess = await verifyFileAccess(imgRecord.key, userId)
        if (!imgHasAccess) return null
        const imgBuffer = await downloadFile({
          key: imgRecord.key,
          context: imgRecord.context as StorageContext,
        })
        return { imageId, originalName: imgRecord.originalName, buffer: imgBuffer }
      })
    )

    const assetMap = new Map<string, { filename: string; buffer: Buffer }>()
    const usedFilenames = new Set<string>()

    for (let i = 0; i < fetchResults.length; i++) {
      const result = fetchResults[i]
      if (result.status === 'rejected') {
        logger.warn('Failed to fetch asset for export', {
          imageId: imageIds[i],
          error: toError(result.reason).message,
        })
        continue
      }
      if (!result.value) continue
      const { imageId, originalName, buffer } = result.value
      const preferred = safeFilename(originalName)
      const filename = deduplicatedFilename(preferred, usedFilenames, imageId)
      usedFilenames.add(filename)
      assetMap.set(imageId, { filename, buffer })
    }

    for (const [imageId, asset] of assetMap) {
      const escapedId = imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const replacement = `./assets/${asset.filename}`
      mdContent = mdContent.replace(
        new RegExp(`/api/files/view/${escapedId}`, 'g'),
        () => replacement
      )
    }

    const zip = new JSZip()
    zip.file(safeFilename(record.originalName), mdContent)
    const assetsFolder = zip.folder('assets')!
    for (const { filename, buffer } of assetMap.values()) {
      assetsFolder.file(filename, buffer)
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const zipName = safeFilename(`${record.originalName.replace(/\.[^.]+$/, '')}.zip`)

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(zipBuffer.length),
      },
    })
  }
)
