import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import JSZip from 'jszip'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileExportContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { verifyFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('FilesExportAPI')

const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])
const VIEW_URL_RE =
  /\/api\/files\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

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

    const record = await getFileMetadataById(id)
    if (!record) {
      logger.warn('File not found by ID', { id })
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const hasAccess = await verifyFileAccess(record.key, authResult.userId)
    if (!hasAccess) {
      logger.warn('Unauthorized file export attempt', { id, userId: authResult.userId })
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!isMarkdown(record.originalName, record.contentType)) {
      const storagePrefix = USE_BLOB_STORAGE ? 'blob' : 's3'
      const servePath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(record.key)}`
      return NextResponse.redirect(new URL(servePath, request.url), { status: 302 })
    }

    const mdBuffer = await downloadFile({ key: record.key, context: record.context as 'workspace' })
    let mdContent = mdBuffer.toString('utf-8')

    const imageIds = [...new Set([...mdContent.matchAll(VIEW_URL_RE)].map((m) => m[1]))]
    logger.info('Exporting markdown with embedded images', { id, imageCount: imageIds.length })

    const assetMap = new Map<string, { filename: string; buffer: Buffer }>()

    await Promise.allSettled(
      imageIds.map(async (imageId) => {
        try {
          const imgRecord = await getFileMetadataById(imageId)
          if (!imgRecord) return
          const imgHasAccess = await verifyFileAccess(imgRecord.key, authResult.userId)
          if (!imgHasAccess) return
          const imgBuffer = await downloadFile({
            key: imgRecord.key,
            context: imgRecord.context as 'workspace',
          })
          assetMap.set(imageId, { filename: imgRecord.originalName, buffer: imgBuffer })
        } catch (err) {
          logger.warn('Failed to fetch asset for export', { imageId, error: toError(err).message })
        }
      })
    )

    for (const [imageId, asset] of assetMap) {
      const escapedId = imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      mdContent = mdContent.replace(
        new RegExp(`/api/files/view/${escapedId}`, 'g'),
        `./assets/${asset.filename}`
      )
    }

    const zip = new JSZip()
    zip.file(record.originalName, mdContent)
    const assets = zip.folder('assets')!
    for (const { filename, buffer } of assetMap.values()) {
      assets.file(filename, buffer)
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const zipName = `${record.originalName.replace(/\.[^.]+$/, '')}.zip`

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(zipBuffer.length),
      },
    })
  }
)
