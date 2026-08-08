/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import { assertOoxmlArchiveWithinLimits, type OoxmlSizeLimits } from '@/lib/file-parsers/zip-guard'

const HIGH_LIMITS: OoxmlSizeLimits = {
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 10_000,
  ratioCheckFloorBytes: 1024 * 1024 * 1024,
}

async function buildZip(
  entries: Record<string, string>,
  options: { comment?: string } = {}
): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content)
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    comment: options.comment,
  })
}

const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50

/**
 * Rewrite every declared uncompressed size — in both the central directory and
 * the local file headers — so the archive under-reports how much it expands to.
 * This is the bypass a declared-size-only check cannot see. Zero-length records
 * (JSZip emits a stored directory entry per folder) are left alone so the
 * archive stays well-formed apart from the lie under test.
 */
function underDeclareSizes(source: Buffer, declared: number): Buffer {
  const buffer = Buffer.from(source)
  for (let offset = 0; offset + 30 <= buffer.length; offset++) {
    const signature = buffer.readUInt32LE(offset)
    if (signature === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      if (buffer.readUInt32LE(offset + 24) !== 0) {
        buffer.writeUInt32LE(declared, offset + 24)
      }
    } else if (signature === LOCAL_FILE_HEADER_SIGNATURE) {
      if (buffer.readUInt32LE(offset + 22) !== 0) {
        buffer.writeUInt32LE(declared, offset + 22)
      }
    }
  }
  return buffer
}

/**
 * Overwrite the compression method on every non-empty record. `where` selects
 * which header is rewritten, so a test can make the two disagree — JSZip trusts
 * the central method while SheetJS switches on the local one.
 */
function setCompressionMethod(
  source: Buffer,
  method: number,
  where: 'central' | 'local' | 'both' = 'both'
): Buffer {
  const buffer = Buffer.from(source)
  for (let offset = 0; offset + 46 <= buffer.length; offset++) {
    const signature = buffer.readUInt32LE(offset)
    if (
      signature === CENTRAL_DIRECTORY_HEADER_SIGNATURE &&
      buffer.readUInt32LE(offset + 24) !== 0 &&
      where !== 'local'
    ) {
      buffer.writeUInt16LE(method, offset + 10)
    } else if (
      signature === LOCAL_FILE_HEADER_SIGNATURE &&
      buffer.readUInt32LE(offset + 22) !== 0 &&
      where !== 'central'
    ) {
      buffer.writeUInt16LE(method, offset + 8)
    }
  }
  return buffer
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
        maxEntryUncompressedBytes: 1024 * 1024 * 1024,
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
        maxEntryUncompressedBytes: 1024 * 1024 * 1024,
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
        maxEntryUncompressedBytes: 1024 * 1024 * 1024,
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
    // Each entry (60 KB) is under the per-entry cap; only the summed total trips
    // the limit, so this must fail on the total branch, not the per-entry one.
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 100_000,
        maxEntryUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(/Decompressed size .* exceeds the maximum allowed/)
  })

  it('rejects an archive whose largest single entry exceeds the per-entry cap', async () => {
    const buffer = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxEntryUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(/single entry's decompressed size .* exceeds the maximum allowed/)
  })

  it('applies the per-entry cap to a non-.xml part resolved through OPC relationships', async () => {
    // The main document part is resolved via relationship target, not a fixed
    // path, so a bomb under a `.bin` name is still DOM-parsed — the cap must not
    // exempt it on filename.
    const buffer = await buildZip({ 'word/document.bin': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxEntryUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(/single entry's decompressed size .* exceeds the maximum allowed/)
  })

  it('rejects a single part larger than the 64 MiB per-entry default before any parser sees it', async () => {
    // A part declaring 70 MiB expanded passes the old 1 GiB ceiling but drives
    // the parser's DOM past a modest heap. `underDeclareSizes` is reused in the
    // over-declaring direction to set the declared size without allocating it.
    const honest = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    const oversized = underDeclareSizes(honest, 70 * 1024 * 1024)
    expect(() => assertOoxmlArchiveWithinLimits(oversized)).toThrow(
      /single entry's decompressed size .* exceeds the maximum allowed 67108864 bytes/
    )
  })

  it('accepts an ordinary document under the default limits', async () => {
    const buffer = await buildZip({
      '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
      '_rels/.rels': '<?xml version="1.0"?><Relationships/>',
      'word/document.xml': `<w:document>${'text '.repeat(5000)}</w:document>`,
    })
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).not.toThrow()
  })

  it('accepts a well-formed archive that carries a trailing comment', async () => {
    const buffer = await buildZip(
      { 'word/document.xml': '<xml>hello</xml>' },
      { comment: 'generated by test' }
    )
    expect(() => assertOoxmlArchiveWithinLimits(buffer, HIGH_LIMITS)).not.toThrow()
  })

  it('fails closed for a ZIP-shaped buffer whose central directory is unparseable', () => {
    const buffer = Buffer.alloc(64)
    buffer.writeUInt32LE(0x04034b50, 0) // local file header signature, no valid EOCD
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).toThrow(ZipBombError)
  })

  it('rejects a decoy EOCD signature that does not validate against the buffer tail', async () => {
    const realZip = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    // A decoy EOCD (zeroed central directory) appended after the genuine archive
    // would, without tail validation, redirect the guard to an empty directory
    // and undercount the real entries.
    const decoy = Buffer.alloc(64)
    decoy.writeUInt32LE(0x06054b50, 0)
    const tampered = Buffer.concat([realZip, decoy])
    expect(() => assertOoxmlArchiveWithinLimits(tampered)).toThrow(ZipBombError)
  })

  it('rejects an archive that under-declares its uncompressed size', async () => {
    // The declared sizes put this archive far under both limits, so only
    // inflating it reveals that it actually expands ~200x further.
    const honest = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    const lying = underDeclareSizes(honest, 1000)

    expect(() => assertOoxmlArchiveWithinLimits(lying, HIGH_LIMITS)).toThrow(ZipBombError)
    expect(() => assertOoxmlArchiveWithinLimits(lying, HIGH_LIMITS)).toThrow(
      /inflates beyond the 1000 bytes it declares/
    )
  })

  it('still accepts the same archive when its declared sizes are honest', async () => {
    const honest = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    expect(() => assertOoxmlArchiveWithinLimits(honest, HIGH_LIMITS)).not.toThrow()
  })

  it('rejects a stored entry whose declared size does not match its payload', async () => {
    const zip = new JSZip()
    zip.file('document.xml', 'A'.repeat(50_000))
    const stored = (await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    })) as Buffer

    expect(() =>
      assertOoxmlArchiveWithinLimits(underDeclareSizes(stored, 10), HIGH_LIMITS)
    ).toThrow(/stored entry declares 10 bytes but holds 50000/)
  })

  it('rejects an entry using a compression method the parsers cannot read', async () => {
    const buffer = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    expect(() =>
      assertOoxmlArchiveWithinLimits(setCompressionMethod(buffer, 12), HIGH_LIMITS)
    ).toThrow(/unsupported compression method 12/)
  })

  it('rejects an entry whose central and local compression methods disagree', async () => {
    // Claiming STORED centrally skips the bounded inflation, while SheetJS
    // switches on the local header and would inflate the payload anyway.
    const honest = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    const split = setCompressionMethod(honest, 0, 'central')

    expect(() => assertOoxmlArchiveWithinLimits(split, HIGH_LIMITS)).toThrow(ZipBombError)
    expect(() => assertOoxmlArchiveWithinLimits(split, HIGH_LIMITS)).toThrow(
      /compression method 0 centrally but 8 locally/
    )
  })

  it('rejects an entry whose central and local declared sizes disagree', async () => {
    const honest = await buildZip({ 'word/document.xml': 'A'.repeat(200_000) })
    const buffer = Buffer.from(honest)
    for (let offset = 0; offset + 30 <= buffer.length; offset++) {
      if (
        buffer.readUInt32LE(offset) === LOCAL_FILE_HEADER_SIGNATURE &&
        buffer.readUInt32LE(offset + 22) !== 0
      ) {
        buffer.writeUInt32LE(64, offset + 22)
      }
    }

    expect(() => assertOoxmlArchiveWithinLimits(buffer, HIGH_LIMITS)).toThrow(
      /200000 bytes centrally but .* locally/
    )
  })

  it('charges entries hidden behind an under-reported EOCD count against the cap', async () => {
    // JSZip's readCentralDir loops on the record signature and keeps every
    // entry it finds — a count mismatch is explicitly not an error there — so
    // entries past the declared count must still be charged against the cap.
    const buffer = await buildZip({
      'a.xml': 'A'.repeat(60_000),
      'b.xml': 'B'.repeat(60_000),
      'c.xml': 'C'.repeat(60_000),
    })
    const eocdOffset = buffer.length - 22
    expect(buffer.readUInt32LE(eocdOffset)).toBe(0x06054b50)
    buffer.writeUInt16LE(1, eocdOffset + 8) // entries on this disk
    buffer.writeUInt16LE(1, eocdOffset + 10) // total entries

    expect(() =>
      assertOoxmlArchiveWithinLimits(buffer, {
        maxTotalUncompressedBytes: 100_000,
        maxEntryUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(/exceeds the maximum allowed/)
  })

  it('accepts a multi-entry archive whose entries all inflate to what they declare', async () => {
    const buffer = await buildZip({
      '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
      '_rels/.rels': '<?xml version="1.0"?><Relationships/>',
      'word/document.xml': `<w:document>${'text '.repeat(5000)}</w:document>`,
      'word/styles.xml': `<w:styles>${'style '.repeat(2000)}</w:styles>`,
    })
    expect(() => assertOoxmlArchiveWithinLimits(buffer, HIGH_LIMITS)).not.toThrow()
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
