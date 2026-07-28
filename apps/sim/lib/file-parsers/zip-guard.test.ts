/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  assertOoxmlArchiveWithinLimits,
  isZipShaped,
  type OoxmlSizeLimits,
  readZipCentralDirectoryStats,
  ZipBombError,
} from '@/lib/file-parsers/zip-guard'

const HIGH_LIMITS: OoxmlSizeLimits = {
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
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

/** Forge a zip bomb by inflating the declared uncompressed size of every central-directory record. */
function forgeDeclaredUncompressedSize(zipBuffer: Buffer, declaredBytes: number): Buffer {
  const forged = Buffer.from(zipBuffer)
  for (let offset = 0; offset + 46 <= forged.length; offset++) {
    if (forged.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      forged.writeUInt32LE(declaredBytes, offset + 24)
    }
  }
  return forged
}

/**
 * Append a syntactically valid EOCD record after an existing archive, declaring
 * `entryCount` records at `cdOffset` (default: an empty central directory
 * anchored at the appended record itself, the shape a backwards scan accepts).
 */
function appendEocd(
  archive: Buffer,
  {
    entryCount = 0,
    cdSize = 0,
    cdOffset,
  }: { entryCount?: number; cdSize?: number; cdOffset?: number } = {}
): Buffer {
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entryCount, 8)
  eocd.writeUInt16LE(entryCount, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdOffset ?? archive.length, 16)
  return Buffer.concat([archive, eocd])
}

interface EocdFields {
  offset: number
  entryCount: number
  cdSize: number
  cdOffset: number
}

/** Read the highest-offset EOCD record of an archive. */
function readEocd(buffer: Buffer): EocdFields {
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return {
        offset,
        entryCount: buffer.readUInt16LE(offset + 10),
        cdSize: buffer.readUInt32LE(offset + 12),
        cdOffset: buffer.readUInt32LE(offset + 16),
      }
    }
  }
  throw new Error('no EOCD record found')
}

/**
 * Splice a 22-byte empty-EOCD decoy between the local file data and the central
 * directory, then rewrite the real EOCD to point past it and to declare one more
 * record than the directory holds. The decoy resolves trivially ("0 records at
 * offset 0"), and JSZip does not error on a count mismatch — it keeps whatever
 * records it found — so a guard that discards the mismatched candidate measures
 * nothing at all and reads the archive as empty.
 */
function spliceCountMismatchDecoy(archive: Buffer): Buffer {
  const eocd = readEocd(archive)
  const decoy = Buffer.alloc(22)
  decoy.writeUInt32LE(0x06054b50, 0)

  const realEocd = Buffer.from(archive.subarray(eocd.offset))
  realEocd.writeUInt16LE(eocd.entryCount + 1, 8)
  realEocd.writeUInt16LE(eocd.entryCount + 1, 10)
  realEocd.writeUInt32LE(eocd.cdOffset + decoy.length, 16)

  return Buffer.concat([
    archive.subarray(0, eocd.cdOffset),
    decoy,
    archive.subarray(eocd.cdOffset, eocd.offset),
    realEocd,
  ])
}

/** Saturate the first central-directory record's 32-bit size and declare the real size in a ZIP64 extra field. */
function forgeZip64DeclaredUncompressedSize(zipBuffer: Buffer, declaredBytes: bigint): Buffer {
  const cdStart = zipBuffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  const fileNameLength = zipBuffer.readUInt16LE(cdStart + 28)
  const extraFieldLength = zipBuffer.readUInt16LE(cdStart + 30)
  const extraStart = cdStart + 46 + fileNameLength

  const zip64Field = Buffer.alloc(12)
  zip64Field.writeUInt16LE(0x0001, 0)
  zip64Field.writeUInt16LE(8, 2)
  zip64Field.writeBigUInt64LE(declaredBytes, 4)

  const head = Buffer.from(zipBuffer.subarray(0, extraStart))
  head.writeUInt32LE(0xffffffff, cdStart + 24)
  head.writeUInt16LE(extraFieldLength + zip64Field.length, cdStart + 30)

  const forged = Buffer.concat([head, zip64Field, zipBuffer.subarray(extraStart)])
  const eocd = readEocd(forged)
  forged.writeUInt32LE(eocd.cdSize + zip64Field.length, eocd.offset + 12)
  return forged
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

  it('ignores a decoy EOCD whose central directory does not check out', async () => {
    const realZip = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    // A decoy EOCD claiming an empty central directory at offset 0 would, if
    // trusted, undercount the real entries and let an oversized archive through.
    const decoy = Buffer.alloc(64)
    decoy.writeUInt32LE(0x06054b50, 0)
    const tampered = Buffer.concat([realZip, decoy])
    expect(() =>
      assertOoxmlArchiveWithinLimits(tampered, {
        maxTotalUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(ZipBombError)
  })

  it('accepts an archive with a single trailing NUL byte after the EOCD', async () => {
    const buffer = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    const padded = Buffer.concat([buffer, Buffer.alloc(1)])
    expect(() => assertOoxmlArchiveWithinLimits(padded, HIGH_LIMITS)).not.toThrow()
    await expect(JSZip.loadAsync(padded)).resolves.toBeDefined()
  })

  it('accepts an archive with a kilobyte of trailing garbage after the EOCD', async () => {
    const buffer = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    const garbage = Buffer.alloc(1024, 0xab)
    const padded = Buffer.concat([buffer, garbage])
    expect(() => assertOoxmlArchiveWithinLimits(padded, HIGH_LIMITS)).not.toThrow()
    await expect(JSZip.loadAsync(padded)).resolves.toBeDefined()
  })

  it('still rejects an oversized archive that carries trailing bytes', async () => {
    const buffer = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    const padded = Buffer.concat([buffer, Buffer.alloc(1024, 0xab)])
    expect(() =>
      assertOoxmlArchiveWithinLimits(padded, {
        maxTotalUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(ZipBombError)
  })

  it('still rejects a high-ratio archive that carries trailing bytes', async () => {
    const buffer = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    const padded = Buffer.concat([buffer, Buffer.alloc(1024, 0xab)])
    expect(() =>
      assertOoxmlArchiveWithinLimits(padded, {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 5,
        ratioCheckFloorBytes: 1000,
      })
    ).toThrow(ZipBombError)
  })

  it('rejects a forged zip bomb under the default limits, with or without trailing bytes', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)
    for (const tail of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(1024, 0xab)]) {
      expect(() => assertOoxmlArchiveWithinLimits(Buffer.concat([bomb, tail]))).toThrow(
        ZipBombError
      )
    }
  })

  it('rejects a bomb followed by an appended empty EOCD record', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)
    // The appended record is internally consistent and sits at the highest
    // offset, so a scan that trusts one record reads "empty archive" and lets
    // the real central directory through.
    const tampered = appendEocd(bomb)
    expect(() => assertOoxmlArchiveWithinLimits(tampered)).toThrow(ZipBombError)
  })

  it('rejects a bomb followed by an appended EOCD declaring a small central directory', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)
    const decoyArchive = await buildZip({ 'harmless.xml': '<xml>ok</xml>' })
    const decoy = readEocd(decoyArchive)
    const tampered = appendEocd(Buffer.concat([bomb, decoyArchive]), {
      entryCount: decoy.entryCount,
      cdSize: decoy.cdSize,
      cdOffset: bomb.length + decoy.cdOffset,
    })
    expect(() => assertOoxmlArchiveWithinLimits(tampered)).toThrow(ZipBombError)
  })

  it('rejects an oversized archive followed by an appended empty EOCD record', async () => {
    const archive = await buildZip({ 'xl/worksheets/sheet1.xml': 'A'.repeat(200_000) })
    expect(() =>
      assertOoxmlArchiveWithinLimits(appendEocd(archive), {
        maxTotalUncompressedBytes: 100_000,
        maxCompressionRatio: 10_000,
        ratioCheckFloorBytes: 1024 * 1024 * 1024,
      })
    ).toThrow(ZipBombError)
  })

  it('accepts a within-limits archive that carries an appended empty EOCD record', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    expect(() => assertOoxmlArchiveWithinLimits(appendEocd(archive), HIGH_LIMITS)).not.toThrow()
  })

  it('rejects a bomb hidden behind a single prepended byte, which JSZip still inflates', async () => {
    const archive = await buildZip({ 'word/document.xml': 'A'.repeat(64 * 1024 * 1024) })
    // Prepending shifts the whole archive, but the EOCD's cdOffset is absolute,
    // so no candidate resolves. The buffer no longer starts with a ZIP
    // signature either, so a fail-closed branch keyed on byte 0 lets it past.
    const attack = Buffer.concat([Buffer.from([0x00]), archive])
    expect(isZipShaped(attack)).toBe(false)
    expect(() => assertOoxmlArchiveWithinLimits(attack)).toThrow(ZipBombError)

    // The threat is real, not merely a shape: JSZip reads past the prepended
    // byte and inflates the entry in full.
    const loaded = await JSZip.loadAsync(attack)
    const inflated = await loaded.file('word/document.xml')!.async('nodebuffer')
    expect(inflated.length).toBe(64 * 1024 * 1024)
    expect(inflated.length / attack.length).toBeGreaterThan(100)

    // Same bomb, with the real EOCD pushed past the 64 KiB comment window by
    // trailing junk. A spec-correct windowed scan sees no EOCD signature at all
    // and, with byte 0 no longer a ZIP signature, no-ops entirely — while JSZip,
    // which scans to offset 0, still finds the record and inflates 64 MiB. The
    // guard must model the parser, so the scan covers the whole buffer.
    const windowed = Buffer.concat([attack, Buffer.alloc(70_000, 0xab)])
    expect(isZipShaped(windowed)).toBe(false)
    expect(() => assertOoxmlArchiveWithinLimits(windowed)).toThrow(ZipBombError)

    const loadedWindowed = await JSZip.loadAsync(windowed)
    const inflatedWindowed = await loadedWindowed.file('word/document.xml')!.async('nodebuffer')
    expect(inflatedWindowed.length).toBe(64 * 1024 * 1024)
  }, 120_000)

  it('rejects a within-limits archive whose EOCD sits past the 64 KiB comment window', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    const attack = Buffer.concat([Buffer.from([0x00]), archive, Buffer.alloc(70_000, 0xab)])
    expect(() => assertOoxmlArchiveWithinLimits(attack, HIGH_LIMITS)).toThrow(ZipBombError)
  })

  it('rejects a bomb whose EOCD lies about the entry count behind an empty-EOCD decoy', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 200_000)
    // Discarding the count-mismatched candidate measured NOTHING for the only
    // interpretation JSZip actually parses, leaving the trivially-resolvable
    // decoy as the whole verdict: "empty archive". The declared size stays under
    // the absolute cap so the ratio check — not the walk's early size abort — is
    // what has to see the entry.
    expect(() =>
      assertOoxmlArchiveWithinLimits(spliceCountMismatchDecoy(bomb), {
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxCompressionRatio: 5,
        ratioCheckFloorBytes: 1000,
      })
    ).toThrow(ZipBombError)
  })

  it('measures the real central directory when the EOCD lies about the entry count', async () => {
    const archive = await buildZip({ 'a.xml': 'a', 'b.xml': 'b', 'c.xml': 'c' })
    expect(readZipCentralDirectoryStats(spliceCountMismatchDecoy(archive))?.entryCount).toBe(3)
  })

  it('rejects a prepended bomb that also carries an empty-EOCD decoy', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)
    // Prepending shifts the real EOCD's absolute cdOffset out from under the
    // guard while JSZip rebases past the leading byte; the decoy then supplies a
    // clean "empty archive" reading. A resolvable candidate must not excuse an
    // unresolvable one.
    const attack = Buffer.concat([Buffer.from([0x00]), spliceCountMismatchDecoy(bomb)])
    expect(() => assertOoxmlArchiveWithinLimits(attack)).toThrow(ZipBombError)
  })

  it('refuses an EOCD signature truncated by the buffer end', () => {
    // Too close to the tail to hold a full record, so it yields no candidate —
    // but it is still a ZIP signature the guard could not follow, and reading it
    // as "not a ZIP" is the same fail-open the prepend evasion exploits.
    const buffer = Buffer.alloc(64)
    Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(buffer, 50)
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).toThrow(ZipBombError)
  })

  it('refuses, quickly, a buffer whose candidates each anchor a distinct maximal walk', () => {
    // The run cache is keyed by central-directory offset, so distinct offsets
    // defeat it and cost MAX_EOCD_CANDIDATES full walks. The shared record budget
    // bounds that, and exhausting it is unverifiable rather than "measured 0".
    const buffer = Buffer.alloc(4 * 1024 * 1024)
    for (let offset = 0; offset + 46 <= buffer.length; offset += 46) {
      buffer.writeUInt32LE(CENTRAL_DIRECTORY_HEADER_SIGNATURE, offset)
    }
    for (let i = 0; i < 128; i++) {
      const offset = buffer.length - 128 * 22 + i * 22
      buffer.writeUInt32LE(0x06054b50, offset)
      buffer.writeUInt32LE(i * 46, offset + 16)
    }

    const start = performance.now()
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).toThrow(ZipBombError)
    expect(performance.now() - start).toBeLessThan(250)
  })

  it('survives a central-directory record whose extra field runs past the buffer end', () => {
    // A truncated directory can declare an extra field longer than what remains.
    // An unclamped read raises a raw RangeError, which escapes callers that
    // expect a typed archive error (the upload path calls this outside any try).
    const buffer = Buffer.alloc(68)
    buffer.writeUInt32LE(0x06054b50, 0)
    buffer.writeUInt16LE(1, 8)
    buffer.writeUInt16LE(1, 10)
    buffer.writeUInt32LE(22, 16)
    buffer.writeUInt32LE(CENTRAL_DIRECTORY_HEADER_SIGNATURE, 22)
    buffer.writeUInt32LE(0xffffffff, 22 + 24)
    buffer.writeUInt16LE(0xffff, 22 + 30)

    expect(readZipCentralDirectoryStats(buffer)).toEqual({
      entryCount: 1,
      totalExtraFieldBytes: 0xffff,
    })
  })

  it('rejects a within-limits archive behind a prepended byte', async () => {
    // Defined, deliberate behaviour: an unresolvable EOCD is refused whether or
    // not the archive behind it is benign. Nothing in the OOXML pipeline emits
    // leading data, so the only producers of this shape are evasion attempts.
    const archive = await buildZip({ 'word/document.xml': '<xml>hello world</xml>' })
    const prepended = Buffer.concat([Buffer.from([0x00]), archive])
    expect(() => assertOoxmlArchiveWithinLimits(prepended, HIGH_LIMITS)).toThrow(ZipBombError)
  })

  it('rejects a bomb behind a kilobyte of prepended garbage', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeDeclaredUncompressedSize(archive, 0xfffffff0)
    const attack = Buffer.concat([Buffer.alloc(1024, 0xab), bomb])
    expect(() => assertOoxmlArchiveWithinLimits(attack)).toThrow(ZipBombError)
  })

  it('no-ops for a stray EOCD signature that resolves to an empty archive', () => {
    // The zero fill after the signature reads as "0 records at offset 0", which
    // walks cleanly to an empty central directory. A resolvable record needs no
    // fail-closed treatment — the buffer has been inspected, and it is empty.
    const buffer = Buffer.alloc(512)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0)
    Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(buffer, 300)
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).not.toThrow()
  })

  it('rejects a non-ZIP buffer whose stray EOCD signature does not resolve', () => {
    // A coincidental `PK\x05\x06` followed by bytes that point nowhere is
    // ~1.5e-5 likely for random data in the 64 KiB window, and the alternative
    // reading — "not ZIP-shaped, let it through" — is exactly the bypass above.
    // Refusing costs one parse with a clear error, against an OOM that takes
    // down every tenant sharing the worker.
    const buffer = Buffer.alloc(512)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0)
    Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(buffer, 300)
    buffer.writeUInt16LE(4, 300 + 10)
    buffer.writeUInt32LE(64, 300 + 16)
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).toThrow(ZipBombError)
  })

  it('rejects a buffer whose scan window is flooded with EOCD signatures', () => {
    const buffer = Buffer.alloc(4096)
    for (let offset = 0; offset + 4 <= buffer.length; offset += 8) {
      Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(buffer, offset)
    }
    expect(() => assertOoxmlArchiveWithinLimits(buffer)).toThrow(ZipBombError)
  })

  it('reports the worst-case record count across EOCD interpretations', async () => {
    const archive = await buildZip({ 'a.xml': 'a', 'b.xml': 'b', 'c.xml': 'c' })
    expect(readZipCentralDirectoryStats(archive)?.entryCount).toBe(3)
    expect(readZipCentralDirectoryStats(appendEocd(archive))?.entryCount).toBe(3)
  })

  it('reads a ZIP64 declared uncompressed size from the central-directory extra field', async () => {
    const archive = await buildZip({ 'word/document.xml': '<xml>hello</xml>' })
    const bomb = forgeZip64DeclaredUncompressedSize(archive, 8n * 1024n * 1024n * 1024n)
    expect(() => assertOoxmlArchiveWithinLimits(bomb)).toThrow(ZipBombError)
  })

  it('no-ops for a legacy OLE2 document containing the EOCD byte sequence', () => {
    // Non-ZIP documents carry these four bytes by chance, and the OOXML parsers
    // depend on a no-op here so their OLE2/plaintext fallback can run. The
    // record's cdOffset lands outside the buffer, so no parser can read a
    // directory from it and it carries no signal either way.
    const body = Buffer.alloc(4096, 0x41)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(body, 0)
    const stray = Buffer.alloc(22)
    stray.writeUInt32LE(0x06054b50, 0)
    stray.writeUInt16LE(3, 8)
    stray.writeUInt16LE(3, 10)
    stray.writeUInt32LE(0xdeadbe, 12)
    stray.writeUInt32LE(0xdeadbe, 16)
    stray.copy(body, 2000)

    expect(() => assertOoxmlArchiveWithinLimits(body)).not.toThrow()
  })

  it('no-ops for plaintext containing the EOCD byte sequence', () => {
    const text = Buffer.concat([
      Buffer.from('Quarterly report. '.repeat(50)),
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.from('...more prose follows here.'.repeat(50)),
    ])
    expect(() => assertOoxmlArchiveWithinLimits(text)).not.toThrow()
  })

  it('no-ops for a legacy OLE2/CFB document', () => {
    const ole2 = Buffer.alloc(1024)
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole2, 0)
    expect(() => assertOoxmlArchiveWithinLimits(ole2)).not.toThrow()
  })

  it('no-ops for a garbage buffer that is not ZIP-shaped', () => {
    const garbage = Buffer.alloc(4096)
    for (let i = 0; i < garbage.length; i++) {
      garbage[i] = (i * 31 + 7) % 251
    }
    expect(() => assertOoxmlArchiveWithinLimits(garbage)).not.toThrow()
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
