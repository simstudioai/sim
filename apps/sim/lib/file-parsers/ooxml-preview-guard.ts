import type { JSZipObject } from 'jszip'
import {
  MAX_OOXML_ENTRY_UNCOMPRESSED_BYTES,
  MAX_OOXML_TOTAL_UNCOMPRESSED_BYTES,
  ZipBombError,
} from '@/lib/file-parsers/ooxml-limits'

export interface OoxmlPreviewLimits {
  maxTotalUncompressedBytes: number
  maxEntryUncompressedBytes: number
}

/**
 * The central directory records each entry's declared uncompressed size, so
 * `JSZip.loadAsync` exposes it without inflating anything.
 */
function readDeclaredUncompressedSize(entry: JSZipObject): number | undefined {
  const data = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

/**
 * Reject an OOXML archive whose declared uncompressed size exceeds the shared
 * OOXML bounds, before a browser preview (docx-preview, SheetJS) inflates it and
 * exhausts the tab. `JSZip.loadAsync` reads the central directory without
 * inflating any entry, so this inspects the declared sizes cheaply.
 *
 * Declared sizes are attacker-controlled, so a lying archive can still slip past;
 * the browser has no bounded synchronous inflate to verify them the way the
 * server guard does. This catches the honest bombs, the realistic preview case.
 */
export async function assertOoxmlPreviewWithinLimits(
  data: ArrayBuffer | Uint8Array,
  {
    maxTotalUncompressedBytes = MAX_OOXML_TOTAL_UNCOMPRESSED_BYTES,
    maxEntryUncompressedBytes = MAX_OOXML_ENTRY_UNCOMPRESSED_BYTES,
  }: Partial<OoxmlPreviewLimits> = {}
): Promise<void> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(data)

  let total = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const size = readDeclaredUncompressedSize(entry)
    if (size === undefined) continue
    total += size
    if (size > maxEntryUncompressedBytes || total > maxTotalUncompressedBytes) {
      throw new ZipBombError('This file is too large to preview safely')
    }
  }
}
