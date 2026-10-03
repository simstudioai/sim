import { PDFDocument } from 'pdf-lib'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ArtifactObservation } from '@/lib/mothership/generated/observations'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { prepareImageForVision } from '@/lib/workspace-files/prepare-image-for-vision'
import {
  renderDocumentForVision,
  resolveDocumentPages,
} from '@/lib/workspace-files/render-document-for-vision'

const MAX_OBSERVATION_BYTES = 8 * 1024 * 1024

/** Decode already-authorized bytes without creating workspace files. */
export async function decodeFileVisual({
  buffer,
  name,
  type,
  pages: requestedPageRange,
  render,
  signal,
}: {
  buffer: Buffer
  name: string
  type: string
  pages?: string
  render?: boolean
  signal?: AbortSignal
}) {
  const sourceType = resolveEffectiveMimeType(type, name).split(';')[0]?.trim().toLowerCase() ?? ''
  let bytes = buffer
  let mediaType: ArtifactObservation['mediaType']
  let pages: { first: number; last: number; total: number } | undefined
  const requestedPages = requestedPageRange
  if (sourceType === 'application/pdf' && !render) {
    const pdf = await PDFDocument.load(buffer)
    pages = resolveDocumentPages(pdf.getPageCount(), requestedPages)
    if (pages.first !== 1 || pages.last !== pages.total) {
      const selected = await PDFDocument.create()
      const first = pages.first
      for (const page of await selected.copyPages(
        pdf,
        Array.from({ length: pages.last - pages.first + 1 }, (_, i) => first - 1 + i)
      ))
        selected.addPage(page)
      bytes = Buffer.from(await selected.save())
    }
    mediaType = 'application/pdf'
  } else if (sourceType.startsWith('image/')) {
    if (requestedPageRange !== undefined)
      throw new OrchestrationError('validation', '--pages applies only to documents.')
    const prepared = await prepareImageForVision(buffer, signal)
    bytes = prepared.buffer
    mediaType = prepared.mediaType
  } else {
    const rendered = await renderDocumentForVision(buffer, sourceType, name, requestedPages, signal)
    bytes = rendered.buffer
    mediaType = rendered.mediaType
    pages = { first: rendered.first, last: rendered.last, total: rendered.total }
  }
  signal?.throwIfAborted()
  if (bytes.length > MAX_OBSERVATION_BYTES)
    throw new OrchestrationError(
      'payload_too_large',
      'The visual result exceeds 8 MiB. Select fewer document pages with --pages.'
    )
  return {
    buffer: bytes,
    mediaType,
    pages,
    truncated: pages !== undefined && (pages.first !== 1 || pages.last !== pages.total),
  }
}
