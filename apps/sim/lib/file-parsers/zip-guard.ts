import { inflateRawSync } from 'zlib'
import { createLogger } from '@sim/logger'
import {
  ArchiveIntegrityError,
  MAX_OOXML_CENTRAL_DIRECTORY_EXTRA_BYTES,
  MAX_OOXML_CENTRAL_DIRECTORY_RECORDS,
  MAX_OOXML_ENTRY_UNCOMPRESSED_BYTES,
  MAX_OOXML_TOTAL_UNCOMPRESSED_BYTES,
  ZipBombError,
} from '@/lib/file-parsers/ooxml-limits'

const logger = createLogger('ZipBombGuard')

/**
 * OOXML documents (xlsx/docx/pptx) are ZIP archives. Decompression libraries
 * (SheetJS, mammoth, officeparser) inflate every entry and build the full
 * in-memory object graph before any application-level size cap applies. A
 * crafted "zip bomb" — highly repetitive XML that deflates ~100-1000x — can sit
 * comfortably under the compressed-input limit yet expand to many gigabytes,
 * exhausting the worker and crashing the process with an OOM.
 *
 * This guard inspects the ZIP central directory (which records each entry's
 * declared uncompressed size) and rejects archives whose total expanded size,
 * largest single entry, or compression ratio exceeds a safe threshold — without
 * decompressing anything.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50
const ZIP64_EXTRA_FIELD_ID = 0x0001

const EOCD_MIN_SIZE = 22
const ZIP64_EOCD_LOCATOR_SIZE = 20
const CENTRAL_DIRECTORY_HEADER_MIN_SIZE = 46
const LOCAL_FILE_HEADER_MIN_SIZE = 30
const MAX_EOCD_COMMENT_SIZE = 0xffff
const UINT32_SENTINEL = 0xffffffff
const UINT16_SENTINEL = 0xffff

const COMPRESSION_METHOD_STORED = 0
const COMPRESSION_METHOD_DEFLATE = 8

/** General-purpose bit 3: sizes live in a trailing data descriptor, not the local header. */
const DATA_DESCRIPTOR_FLAG = 0x0008

export interface OoxmlSizeLimits {
  /** Hard ceiling on the summed declared uncompressed size of all entries. */
  maxTotalUncompressedBytes: number
  /** Hard ceiling on any single entry's declared uncompressed size — the parser materializes an individual part (e.g. `document.xml`) into a DOM, or base64-embeds media, at a footprint many times the part size. */
  maxEntryUncompressedBytes: number
  /** Maximum allowed expanded:compressed ratio across the whole archive. */
  maxCompressionRatio: number
  /** The ratio check only applies once the expanded size exceeds this floor, so small files are never flagged. */
  ratioCheckFloorBytes: number
}

const ONE_HUNDRED_MEBIBYTES = 100 * 1024 * 1024

/**
 * The downstream parsers (mammoth, SheetJS, officeparser) build a full in-memory
 * DOM/object graph whose peak heap is many times the XML size — measured at
 * ~900 MB resident for 32 MB of expanded WordprocessingML, and mammoth then
 * parses a second time for HTML. The old 1 GiB ceiling let a ~3.5 MB archive
 * expand past what the process could hold and OOM it. The total and per-entry
 * caps here keep a single parse's peak within a modest container's budget while
 * still admitting all but pathologically large documents. The size ceilings are
 * shared with the browser preview guard via {@link ./ooxml-limits}; the ratio
 * heuristic is server-only.
 */
export const DEFAULT_OOXML_SIZE_LIMITS: OoxmlSizeLimits = {
  maxTotalUncompressedBytes: MAX_OOXML_TOTAL_UNCOMPRESSED_BYTES,
  maxEntryUncompressedBytes: MAX_OOXML_ENTRY_UNCOMPRESSED_BYTES,
  maxCompressionRatio: 150,
  ratioCheckFloorBytes: ONE_HUNDRED_MEBIBYTES,
}

/**
 * Whether the buffer is shaped like a ZIP archive — i.e. begins with a local
 * file header (the leading signature of every non-empty ZIP, and thus every
 * OOXML document) or with the EOCD signature of an empty archive. Used to fail
 * closed: a ZIP-shaped buffer the guard cannot parse must be rejected rather
 * than handed to a decompression library.
 */
export function isZipShaped(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false
  }
  const signature = buffer.readUInt32LE(0)
  return signature === LOCAL_FILE_HEADER_SIGNATURE || signature === EOCD_SIGNATURE
}

/**
 * Locate the End Of Central Directory record by scanning backwards from the end
 * of the buffer (it sits within the trailing 22 + comment bytes). A candidate
 * is only accepted when its declared comment length places the record exactly
 * at the buffer tail, so a decoy EOCD signature planted in the comment region
 * cannot redirect the guard to a smaller, attacker-chosen central directory.
 */
function findEocdOffset(buffer: Buffer): number {
  const minStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_EOCD_COMMENT_SIZE)
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= minStart; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) {
      continue
    }
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + EOCD_MIN_SIZE + commentLength === buffer.length) {
      return offset
    }
  }
  return -1
}

interface CentralDirectoryLocation {
  offset: number
  entryCount: number
}

/**
 * Resolve the central directory offset and entry count, following the ZIP64
 * end-of-central-directory chain when the 32-bit fields are saturated.
 */
function locateCentralDirectory(
  buffer: Buffer,
  eocdOffset: number
): CentralDirectoryLocation | null {
  let entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16)

  const needsZip64 = entryCount === UINT16_SENTINEL || cdOffset === UINT32_SENTINEL
  if (needsZip64) {
    const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_SIZE
    if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      return null
    }

    const zip64EocdOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8))
    if (
      zip64EocdOffset < 0 ||
      zip64EocdOffset + 56 > buffer.length ||
      buffer.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE
    ) {
      return null
    }

    entryCount = Number(buffer.readBigUInt64LE(zip64EocdOffset + 32))
    cdOffset = Number(buffer.readBigUInt64LE(zip64EocdOffset + 48))
  }

  if (cdOffset < 0 || cdOffset > buffer.length) {
    return null
  }

  return { offset: cdOffset, entryCount }
}

interface CentralDirectoryEntry {
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

/**
 * Read an entry's sizes, method, and local-header offset, preferring the ZIP64
 * extra field for whichever 32-bit fields are saturated. The saturated 64-bit
 * values appear in the extra field in a fixed order — uncompressed size,
 * compressed size, local-header offset — and only the saturated ones are
 * present, so they must be consumed positionally rather than at fixed offsets.
 */
function readCentralDirectoryEntry(
  buffer: Buffer,
  headerOffset: number,
  fileNameLength: number,
  extraFieldLength: number
): CentralDirectoryEntry {
  const compressionMethod = buffer.readUInt16LE(headerOffset + 10)
  let compressedSize = buffer.readUInt32LE(headerOffset + 20)
  let uncompressedSize = buffer.readUInt32LE(headerOffset + 24)
  let localHeaderOffset = buffer.readUInt32LE(headerOffset + 42)

  const needsZip64 =
    uncompressedSize === UINT32_SENTINEL ||
    compressedSize === UINT32_SENTINEL ||
    localHeaderOffset === UINT32_SENTINEL

  if (needsZip64) {
    const extraStart = headerOffset + CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength
    const extraEnd = extraStart + extraFieldLength
    let cursor = extraStart
    while (cursor + 4 <= extraEnd) {
      const fieldId = buffer.readUInt16LE(cursor)
      const fieldSize = buffer.readUInt16LE(cursor + 2)
      const dataStart = cursor + 4
      if (fieldId === ZIP64_EXTRA_FIELD_ID) {
        let zip64Cursor = dataStart
        const readNext = (): number | null => {
          if (zip64Cursor + 8 > Math.min(extraEnd, dataStart + fieldSize)) {
            return null
          }
          const value = Number(buffer.readBigUInt64LE(zip64Cursor))
          zip64Cursor += 8
          return value
        }
        if (uncompressedSize === UINT32_SENTINEL) {
          uncompressedSize = readNext() ?? uncompressedSize
        }
        if (compressedSize === UINT32_SENTINEL) {
          compressedSize = readNext() ?? compressedSize
        }
        if (localHeaderOffset === UINT32_SENTINEL) {
          localHeaderOffset = readNext() ?? localHeaderOffset
        }
        break
      }
      cursor = dataStart + fieldSize
    }
  }

  return { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset }
}

interface DeclaredSizeStats {
  /** Summed declared uncompressed size across the contiguous run of records. */
  total: number
  /** Largest single entry's declared uncompressed size. */
  largestEntry: number
  /** Records a downstream ZIP parser would materialize. */
  entryCount: number
  /** Summed central-directory extra-field bytes retained by ZIP parsers. */
  totalExtraFieldBytes: number
}

/**
 * Sum the declared uncompressed size of every central-directory entry and track
 * the largest single entry. Returns `null` when the buffer is not a parseable
 * ZIP archive (e.g. legacy binary `.xls`/`.doc`, or a misidentified plaintext
 * file) so the caller can defer to the downstream parser. Stops early once the
 * running total, or a single entry, exceeds the corresponding limit.
 *
 * The per-entry cap covers every entry, not just `.xml` parts: an OOXML part is
 * resolved through OPC relationship targets (mammoth's `officeDocument`
 * relationship, with `word/document.xml` only a fallback), so an arbitrarily
 * named part is still deserialized into a DOM — a name-based exemption would let
 * a bomb sail through under a `.bin` target.
 *
 * Like {@link readZipCentralDirectoryStats}, this charges the CONTIGUOUS run of
 * records rather than the EOCD's declared count. JSZip's `readCentralDir` loops
 * on the record signature and keeps every entry it finds — a count mismatch is
 * explicitly not an error there — so an archive that under-reports its count
 * would otherwise hide honestly-large entries from this cap while the parser
 * still expanded them.
 */
function sumDeclaredUncompressedSize(
  buffer: Buffer,
  limits: OoxmlSizeLimits
): DeclaredSizeStats | null {
  if (buffer.length < EOCD_MIN_SIZE) {
    return null
  }

  const eocdOffset = findEocdOffset(buffer)
  if (eocdOffset < 0) {
    return null
  }

  const location = locateCentralDirectory(buffer, eocdOffset)
  if (!location) {
    return null
  }

  let total = 0
  let largestEntry = 0
  let counted = 0
  let totalExtraFieldBytes = 0
  let cursor = location.offset
  while (
    cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE <= buffer.length &&
    buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraFieldLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)

    const entryBytes = readCentralDirectoryEntry(
      buffer,
      cursor,
      fileNameLength,
      extraFieldLength
    ).uncompressedSize
    totalExtraFieldBytes += extraFieldLength
    total += entryBytes
    if (entryBytes > largestEntry) {
      largestEntry = entryBytes
    }
    if (total > limits.maxTotalUncompressedBytes || entryBytes > limits.maxEntryUncompressedBytes) {
      return { total, largestEntry, entryCount: counted + 1, totalExtraFieldBytes }
    }

    counted += 1
    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  // Fewer records than the archive claims means the directory is malformed;
  // fail closed rather than charging a partial total against the cap.
  if (counted < location.entryCount) {
    return null
  }

  return { total, largestEntry, entryCount: counted, totalExtraFieldBytes }
}

/**
 * A declared-size check alone is not sufficient: the central directory is
 * attacker-controlled, so a bomb can under-report each entry's uncompressed
 * size and sail through. The decompression libraries only notice the mismatch
 * *after* inflating the entry in full — measured at ~560 MB resident for a
 * 498 KB input — so the lie must be caught before they see the buffer.
 *
 * Each entry is therefore inflated here with `maxOutputLength` set to the size
 * it declared. Node's zlib aborts the moment output would exceed that bound, so
 * a lying entry costs only its declared size in memory (~0 for the bomb above)
 * and the inflated bytes are discarded immediately. An honest archive inflates
 * to exactly what it declared and passes, having already been bounded by
 * {@link sumDeclaredUncompressedSize}.
 *
 * The central and local headers must also agree on the compression method and
 * sizes, because the parsers disagree about which one to trust — JSZip reads
 * the central directory, SheetJS switches on the local header — and a record
 * that reads as STORED here but DEFLATE downstream would skip inflation
 * verification entirely.
 *
 * Returns an error message when the archive is lying or is shaped in a way that
 * cannot be verified, and `null` when every entry checks out.
 */
function findInflationMismatch(buffer: Buffer, location: CentralDirectoryLocation): string | null {
  let cursor = location.offset
  let verified = 0

  // Walk the contiguous run of records rather than the EOCD's declared count —
  // the run is what a decompression library actually allocates an entry per, so
  // a lied-down count must not be able to hide an entry from verification.
  while (
    cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE <= buffer.length &&
    buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraFieldLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset } =
      readCentralDirectoryEntry(buffer, cursor, fileNameLength, extraFieldLength)

    if (localHeaderOffset + LOCAL_FILE_HEADER_MIN_SIZE > buffer.length) {
      return 'entry points outside the archive'
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      return 'entry has an invalid local file header'
    }

    const dataStart =
      localHeaderOffset +
      LOCAL_FILE_HEADER_MIN_SIZE +
      buffer.readUInt16LE(localHeaderOffset + 26) +
      buffer.readUInt16LE(localHeaderOffset + 28)
    if (dataStart > buffer.length) {
      return 'entry data starts outside the archive'
    }

    // The two headers must agree on how the payload is encoded. JSZip trusts
    // the central directory while SheetJS switches on the local header's
    // method, so a record that claims STORED centrally and DEFLATE locally
    // would skip verification here and still be inflated downstream.
    const localFlags = buffer.readUInt16LE(localHeaderOffset + 6)
    const localMethod = buffer.readUInt16LE(localHeaderOffset + 8)
    if (localMethod !== compressionMethod) {
      return `entry declares compression method ${compressionMethod} centrally but ${localMethod} locally`
    }

    // Sizes must agree too, for the same reason. They are legitimately absent
    // from the local header when the data-descriptor flag is set, and are
    // sentinels under ZIP64, so only compare when both are actually present.
    const hasDataDescriptor = (localFlags & DATA_DESCRIPTOR_FLAG) !== 0
    const localCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18)
    const localUncompressedSize = buffer.readUInt32LE(localHeaderOffset + 22)
    if (
      !hasDataDescriptor &&
      localCompressedSize !== UINT32_SENTINEL &&
      localUncompressedSize !== UINT32_SENTINEL &&
      (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)
    ) {
      return `entry declares ${compressedSize}/${uncompressedSize} bytes centrally but ${localCompressedSize}/${localUncompressedSize} locally`
    }

    if (compressionMethod === COMPRESSION_METHOD_STORED) {
      // A stored entry is its own payload, so any divergence is a lie outright.
      if (uncompressedSize !== compressedSize) {
        return `stored entry declares ${uncompressedSize} bytes but holds ${compressedSize}`
      }
    } else if (compressionMethod === COMPRESSION_METHOD_DEFLATE) {
      // The declared compressed size is untrusted too; clamp it to the buffer
      // and let the deflate stream's own end marker terminate the read.
      const dataEnd = Math.min(dataStart + compressedSize, buffer.length)
      try {
        inflateRawSync(buffer.subarray(dataStart, dataEnd), {
          maxOutputLength: Math.max(uncompressedSize, 1),
        })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ERR_BUFFER_TOO_LARGE') {
          return `entry inflates beyond the ${uncompressedSize} bytes it declares`
        }
        // A stream the guard cannot inflate is one the parser cannot read
        // either; treat it as unverifiable rather than assuming it is safe.
        return `entry could not be inflated for verification (${code ?? 'unknown error'})`
      }
    } else {
      return `entry uses unsupported compression method ${compressionMethod}`
    }

    verified += 1
    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  if (verified < location.entryCount) {
    return `central directory declares ${location.entryCount} entries but only ${verified} could be verified`
  }

  return null
}

/** Parse-time shape of a ZIP central directory, read without decompressing anything. */
export interface ZipCentralDirectoryStats {
  /** Records in the contiguous central-directory run — what a per-signature parser allocates. */
  entryCount: number
  /** Summed declared extra-field bytes across those records. */
  totalExtraFieldBytes: number
}

/**
 * Walk the real central directory (EOCD-anchored, decoy-resistant, ZIP64-aware —
 * the same anchoring as {@link assertOoxmlArchiveWithinLimits}) and report its
 * record count and summed extra-field bytes, so callers can bound a parser's
 * object graph before handing it the buffer. The walk covers the CONTIGUOUS run
 * of records at the central-directory offset rather than trusting the EOCD's
 * declared count, because that run is what JSZip actually allocates one entry
 * per — a lied count can neither hide records nor inflate the tally. Unlike a
 * raw whole-buffer signature scan, STORED entry payloads (e.g. a nested `.zip`
 * archived without recompression) are never miscounted as records. Returns
 * `null` when the buffer is not a parseable ZIP, so callers can fail closed.
 */
export function readZipCentralDirectoryStats(buffer: Buffer): ZipCentralDirectoryStats | null {
  if (buffer.length < EOCD_MIN_SIZE) {
    return null
  }

  const eocdOffset = findEocdOffset(buffer)
  if (eocdOffset < 0) {
    return null
  }

  const location = locateCentralDirectory(buffer, eocdOffset)
  if (!location) {
    return null
  }

  let entryCount = 0
  let totalExtraFieldBytes = 0
  let cursor = location.offset
  while (
    cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE <= buffer.length &&
    buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraFieldLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)

    entryCount += 1
    totalExtraFieldBytes += extraFieldLength
    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  if (entryCount < location.entryCount) {
    return null
  }

  return { entryCount, totalExtraFieldBytes }
}

/**
 * Reject an OOXML archive whose expanded size or compression ratio exceeds safe
 * bounds, before any decompression library materializes it.
 *
 * Runs in two stages. The declared sizes in the central directory are checked
 * first, which costs nothing and rejects a straightforward bomb outright. Those
 * sizes are attacker-controlled, so every entry is then inflated under a
 * `maxOutputLength` bound equal to what it declared — see
 * {@link findInflationMismatch} — which catches an archive that under-reports
 * its way past the first stage.
 *
 * Fails closed: a ZIP-shaped buffer whose central directory cannot be parsed,
 * or whose entries cannot be verified, is rejected rather than passed through,
 * so a malformed archive that a downstream library still inflates cannot bypass
 * the guard. Genuinely non-ZIP inputs (legacy OLE `.xls`/`.doc`, misidentified
 * plaintext) no-op and defer to the downstream parser's own validation.
 */
export function assertOoxmlArchiveWithinLimits(
  buffer: Buffer,
  limits: OoxmlSizeLimits = DEFAULT_OOXML_SIZE_LIMITS
): void {
  const declared = sumDeclaredUncompressedSize(buffer, limits)
  if (declared === null) {
    if (isZipShaped(buffer)) {
      logger.warn('Rejected ZIP-shaped archive: central directory could not be parsed', {
        compressedBytes: buffer.length,
      })
      throw new ArchiveIntegrityError(
        'Unable to inspect ZIP central directory; refusing to parse an unverifiable ZIP-shaped archive'
      )
    }
    return
  }

  const { total: totalUncompressed, largestEntry, entryCount, totalExtraFieldBytes } = declared

  if (largestEntry > limits.maxEntryUncompressedBytes) {
    logger.warn('Rejected OOXML archive: a single entry exceeds the per-entry limit', {
      largestEntry,
      maxEntryUncompressedBytes: limits.maxEntryUncompressedBytes,
      compressedBytes: buffer.length,
    })
    throw new ZipBombError(
      `A single entry's decompressed size (${largestEntry} bytes) exceeds the maximum allowed ${limits.maxEntryUncompressedBytes} bytes`
    )
  }

  if (totalUncompressed > limits.maxTotalUncompressedBytes) {
    logger.warn('Rejected OOXML archive: declared expanded size exceeds limit', {
      totalUncompressed,
      maxTotalUncompressedBytes: limits.maxTotalUncompressedBytes,
      compressedBytes: buffer.length,
    })
    throw new ZipBombError(
      `Decompressed size (${totalUncompressed} bytes) exceeds the maximum allowed ${limits.maxTotalUncompressedBytes} bytes`
    )
  }

  if (entryCount > MAX_OOXML_CENTRAL_DIRECTORY_RECORDS) {
    logger.warn('Rejected OOXML archive: central-directory record count exceeds limit', {
      entryCount,
      maxEntryCount: MAX_OOXML_CENTRAL_DIRECTORY_RECORDS,
      compressedBytes: buffer.length,
    })
    throw new ZipBombError(
      `Archive contains ${entryCount} entries, exceeding the maximum allowed ${MAX_OOXML_CENTRAL_DIRECTORY_RECORDS}`
    )
  }

  if (totalExtraFieldBytes > MAX_OOXML_CENTRAL_DIRECTORY_EXTRA_BYTES) {
    logger.warn('Rejected OOXML archive: central-directory metadata exceeds limit', {
      totalExtraFieldBytes,
      maxExtraFieldBytes: MAX_OOXML_CENTRAL_DIRECTORY_EXTRA_BYTES,
      compressedBytes: buffer.length,
    })
    throw new ZipBombError(
      `Archive central-directory metadata (${totalExtraFieldBytes} bytes) exceeds the maximum allowed ${MAX_OOXML_CENTRAL_DIRECTORY_EXTRA_BYTES} bytes`
    )
  }

  const ratio = totalUncompressed / Math.max(buffer.length, 1)
  if (totalUncompressed > limits.ratioCheckFloorBytes && ratio > limits.maxCompressionRatio) {
    logger.warn('Rejected OOXML archive: compression ratio exceeds limit', {
      totalUncompressed,
      compressedBytes: buffer.length,
      ratio,
      maxCompressionRatio: limits.maxCompressionRatio,
    })
    throw new ZipBombError(
      `Compression ratio (${ratio.toFixed(1)}x) exceeds the maximum allowed ${limits.maxCompressionRatio}x`
    )
  }

  const eocdOffset = findEocdOffset(buffer)
  const location = eocdOffset < 0 ? null : locateCentralDirectory(buffer, eocdOffset)
  if (!location) {
    logger.warn('Rejected ZIP-shaped archive: central directory could not be re-read', {
      compressedBytes: buffer.length,
    })
    throw new ArchiveIntegrityError(
      'Unable to inspect ZIP central directory; refusing to parse an unverifiable ZIP-shaped archive'
    )
  }

  const mismatch = findInflationMismatch(buffer, location)
  if (mismatch) {
    logger.warn('Rejected OOXML archive: declared sizes do not match actual contents', {
      reason: mismatch,
      declaredTotalUncompressed: totalUncompressed,
      compressedBytes: buffer.length,
    })
    throw new ArchiveIntegrityError(`Archive contents do not match declared sizes: ${mismatch}`)
  }
}
