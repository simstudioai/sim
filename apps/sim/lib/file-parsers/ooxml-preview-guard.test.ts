/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import { assertOoxmlPreviewWithinLimits } from '@/lib/file-parsers/ooxml-preview-guard'

async function buildZip(entries: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

const TINY_LIMITS = {
  maxTotalUncompressedBytes: 1024 * 1024,
  maxEntryUncompressedBytes: 100_000,
}

describe('assertOoxmlPreviewWithinLimits', () => {
  it('accepts an archive within the limits', async () => {
    const data = await buildZip({ 'word/document.xml': '<w:document/>' })
    await expect(assertOoxmlPreviewWithinLimits(data, TINY_LIMITS)).resolves.toBeUndefined()
  })

  it('rejects an archive whose single part exceeds the per-entry limit', async () => {
    const data = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    await expect(assertOoxmlPreviewWithinLimits(data, TINY_LIMITS)).rejects.toBeInstanceOf(
      ZipBombError
    )
  })

  it('rejects an archive whose summed parts exceed the total limit', async () => {
    const data = await buildZip({
      'a.xml': 'A'.repeat(60_000),
      'b.xml': 'B'.repeat(60_000),
      'c.xml': 'C'.repeat(60_000),
    })
    await expect(
      assertOoxmlPreviewWithinLimits(data, {
        maxTotalUncompressedBytes: 100_000,
        maxEntryUncompressedBytes: 1024 * 1024,
      })
    ).rejects.toBeInstanceOf(ZipBombError)
  })

  it('accepts an ordinary document under the shared default limits', async () => {
    const data = await buildZip({
      '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
      'word/document.xml': `<w:document>${'text '.repeat(5000)}</w:document>`,
    })
    await expect(assertOoxmlPreviewWithinLimits(data)).resolves.toBeUndefined()
  })
})
