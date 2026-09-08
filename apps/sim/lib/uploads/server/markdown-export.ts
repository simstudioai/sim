import path from 'node:path'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import JSZip from 'jszip'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { StorageContext } from '@/lib/uploads/config'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('MarkdownExport')

export const MAX_EXPORT_TOTAL_BYTES = 250 * 1024 * 1024
const MAX_EXPORT_ASSET_BYTES = 25 * 1024 * 1024

export interface MarkdownExportAsset {
  imageId: string
  key: string
  context: StorageContext
  originalName: string
  size: number
}

export interface MarkdownExportResult {
  buffer: Buffer
  fileName: string
  contentType: string
  format: 'markdown' | 'zip'
  assetCount: number
}

export class MarkdownExportSizeError extends Error {
  constructor(bytes: number) {
    super(
      `This document and its embedded files total ${formatFileSize(bytes)}, which exceeds the ${formatFileSize(MAX_EXPORT_TOTAL_BYTES)} export limit.`
    )
    this.name = 'MarkdownExportSizeError'
  }
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

/**
 * Packages one Markdown snapshot and its already-authorized, count-bounded asset targets.
 * Missing or oversized assets retain their original links; total overflow rejects the export.
 */
export async function createMarkdownExport({
  content,
  fileName,
  assets,
}: {
  content: Buffer
  fileName: string
  assets: readonly MarkdownExportAsset[]
}): Promise<MarkdownExportResult> {
  const declaredBytes = content.length + assets.reduce((sum, asset) => sum + asset.size, 0)
  if (declaredBytes > MAX_EXPORT_TOTAL_BYTES) throw new MarkdownExportSizeError(declaredBytes)

  let retainedBytes = content.length
  let overflowBytes: number | undefined
  const fetched = await mapWithConcurrency(assets, MATERIALIZE_CONCURRENCY, async (asset) => {
    if (overflowBytes !== undefined) return null
    let buffer: Buffer
    try {
      buffer = await downloadFile({
        key: asset.key,
        context: asset.context,
        maxBytes: MAX_EXPORT_ASSET_BYTES,
      })
    } catch (error) {
      logger.warn('Failed to fetch asset for export', {
        imageId: asset.imageId,
        error: toError(error).message,
      })
      return null
    }
    if (overflowBytes !== undefined) return null
    const nextBytes = retainedBytes + buffer.length
    if (nextBytes > MAX_EXPORT_TOTAL_BYTES) {
      overflowBytes = nextBytes
      return null
    }
    retainedBytes = nextBytes
    return { ...asset, buffer }
  })
  if (overflowBytes !== undefined) throw new MarkdownExportSizeError(overflowBytes)

  const assetMap = new Map<string, { filename: string; buffer: Buffer }>()
  const usedFilenames = new Set<string>()
  for (const result of fetched) {
    if (!result) continue
    const preferred = safeFilename(result.originalName)
    const filename = deduplicatedFilename(preferred, usedFilenames, result.imageId)
    usedFilenames.add(filename)
    assetMap.set(result.imageId, { filename, buffer: result.buffer })
  }

  if (assetMap.size === 0) {
    return {
      buffer: content,
      fileName: safeFilename(fileName),
      contentType: 'text/markdown; charset=utf-8',
      format: 'markdown',
      assetCount: 0,
    }
  }

  let markdown = content.toString('utf-8')
  for (const [imageId, asset] of assetMap) {
    const escapedId = imageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const replacement = `./assets/${asset.filename}`
    markdown = markdown
      .replace(new RegExp(`/api/files/view/${escapedId}`, 'g'), () => replacement)
      .replace(new RegExp(`/workspace/[A-Za-z0-9-]+/files/${escapedId}`, 'g'), () => replacement)
  }

  const zip = new JSZip()
  zip.file(safeFilename(fileName), markdown)
  const assetsFolder = zip.folder('assets')!
  for (const { filename, buffer } of assetMap.values()) assetsFolder.file(filename, buffer)

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    fileName: safeFilename(`${fileName.replace(/\.[^.]+$/, '')}.zip`),
    contentType: 'application/zip',
    format: 'zip',
    assetCount: assetMap.size,
  }
}
