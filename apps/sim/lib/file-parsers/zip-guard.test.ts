/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  assertOoxmlArchiveWithinLimits,
  type OoxmlSizeLimits,
  ZipBombError,
} from '@/lib/file-parsers/zip-guard'

const HIGH_LIMITS: OoxmlSizeLimits = {
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 10_000,
  ratioCheckFloorBytes: 1024 * 1024 * 1024,
}

async function buildZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('assertOoxmlArchiveWithinLimits', () => {
  it('accepts a well-formed archive within limits', async () => {
    const buffer = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    expect(() => assertOoxmlArchiveWithinLimits(buffer, HIGH_LIMITS)).not.toThrow()
  })

  it('rejects an archive whose declared expanded size exceeds the absolute cap', async () => {
    const buffer = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(ZipBombError)
  })

  it('rejects an archive whose compression ratio exceeds the limit', async () => {
    const buffer = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 5,
        ratioCheckFloorBytes: 1000,
      })
    ).toThrow(ZipBombError)
  })

  it('does not flag a small but highly compressible archive below the ratio floor', async () => {
    const buffer = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 5,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).not.toThrow()
  })

  it('sums declared sizes across multiple entries', async () => {
    const buffer = await buildZip({
      'a.xml': 'A'.repeat(60_000),
      'b.xml': 'B'.repeat(60_000),
    })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(ZipBombError)
  })

  it('no-ops for buffers that are not ZIP archives', () => {
    const plaintext = Buffer.from('this is just plain text, not a zip archive at all')
    expect(() => assertOoxmlArchiveWithinLimits(plaintext)).not.toThrow()
  })

  it('no-ops for buffers too small to contain an EOCD record', () => {
    expect(() => assertOoxmlArchiveWithinLimits(Buffer.from('PK'))).not.toThrow()
  })

  it('no-ops for an empty buffer', () => {
    expect(() => assertOoxmlArchiveWithinLimits(Buffer.alloc(0))).not.toThrow()
  })
})
