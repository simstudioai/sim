import { createLogger } from '@sim/logger'

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
 * declared uncompressed size) and rejects archives whose total expanded size or
 * compression ratio exceeds a safe threshold — without decompressing anything.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50
const ZIP64_EXTRA_FIELD_ID = 0x0001

const EOCD_SIGNATURE_BYTES = Buffer.from([0x50, 0x4b, 0x05, 0x06])

const EOCD_MIN_SIZE = 22
const ZIP64_EOCD_LOCATOR_SIZE = 20
const CENTRAL_DIRECTORY_HEADER_MIN_SIZE = 46
const MAX_EOCD_COMMENT_SIZE = 0xffff
const UINT32_SENTINEL = 0xffffffff
const UINT16_SENTINEL = 0xffff

/**
 * Ceiling on EOCD signatures considered in the scan window. A real archive has
 * one (plus, rarely, a stray match inside trailing data); a buffer stuffed with
 * more is an attempt to flood the candidate set, and is refused outright.
 */
const MAX_EOCD_CANDIDATES = 128

export interface OoxmlSizeLimits {
  /** Hard ceiling on the summed declared uncompressed size of all entries. */
  maxTotalUncompressedBytes: number
  /** Maximum allowed expanded:compressed ratio across the whole archive. */
  maxCompressionRatio: number
  /** The ratio check only applies once the expanded size exceeds this floor, so small files are never flagged. */
  ratioCheckFloorBytes: number
}

const ONE_GIBIBYTE = 1024 * 1024 * 1024
const ONE_HUNDRED_MEBIBYTES = 100 * 1024 * 1024

/**
 * Defaults sized against the 100 MB compressed-input cap of the parse pipeline.
 * A legitimate Office document stays well under 1 GiB expanded; the bombs
 * described in the threat model expand to multiple gigabytes.
 */
export const DEFAULT_OOXML_SIZE_LIMITS: OoxmlSizeLimits = {
  maxTotalUncompressedBytes: ONE_GIBIBYTE,
  maxCompressionRatio: 150,
  ratioCheckFloorBytes: ONE_HUNDRED_MEBIBYTES,
}

export class ZipBombError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipBombError'
  }
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

interface EocdScan {
  /** Offsets to evaluate; empty when the window is flooded past {@link MAX_EOCD_CANDIDATES}. */
  candidates: number[]
  /** Whether the window holds at least one EOCD signature, flooded or not. */
  sawSignature: boolean
}

/**
 * Every EOCD signature offset in the trailing 22 + 65535 comment-length window.
 * Trailing bytes after the EOCD are common in the wild (self-extracting stubs,
 * appended signatures, generator padding), so the record is not required to end
 * at the buffer tail. Every candidate is returned rather than the first that
 * looks plausible: the decompression libraries this guard protects each pick
 * their own record, so the archive is evaluated under all of them. A flooded
 * window yields no candidates but still reports the signature, so the caller
 * refuses the buffer rather than reading it as "not a ZIP".
 */
function findEocdCandidates(buffer: Buffer): EocdScan {
  const windowStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_EOCD_COMMENT_SIZE)
  const lastOffset = buffer.length - EOCD_MIN_SIZE
  const candidates: number[] = []

  let offset = buffer.indexOf(EOCD_SIGNATURE_BYTES, windowStart)
  while (offset !== -1 && offset <= lastOffset) {
    if (candidates.length >= MAX_EOCD_CANDIDATES) {
      return { candidates: [], sawSignature: true }
    }
    candidates.push(offset)
    offset = buffer.indexOf(EOCD_SIGNATURE_BYTES, offset + 1)
  }

  return { candidates, sawSignature: candidates.length > 0 }
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

/**
 * Read an entry's declared uncompressed size, preferring the ZIP64 extra field
 * when the 32-bit central-directory field is saturated. The saturated 64-bit
 * values appear in the extra field in a fixed order with the uncompressed size
 * first, so it is always the leading 8 bytes of the ZIP64 field.
 */
function readUncompressedSize(
  buffer: Buffer,
  headerOffset: number,
  fileNameLength: number,
  extraFieldLength: number
): number {
  const uncompressedSize = buffer.readUInt32LE(headerOffset + 24)
  if (uncompressedSize !== UINT32_SENTINEL) {
    return uncompressedSize
  }

  const extraStart = headerOffset + CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength
  const extraEnd = extraStart + extraFieldLength
  let cursor = extraStart
  while (cursor + 4 <= extraEnd) {
    const fieldId = buffer.readUInt16LE(cursor)
    const fieldSize = buffer.readUInt16LE(cursor + 2)
    const dataStart = cursor + 4
    if (fieldId === ZIP64_EXTRA_FIELD_ID && dataStart + 8 <= extraEnd) {
      return Number(buffer.readBigUInt64LE(dataStart))
    }
    cursor = dataStart + fieldSize
  }

  return uncompressedSize
}

interface CentralDirectoryWalk {
  /** Records in the contiguous central-directory run at the candidate's offset. */
  entryCount: number
  /** Summed declared uncompressed size across those records. */
  declaredUncompressedBytes: number
  /** Summed declared extra-field bytes across those records. */
  totalExtraFieldBytes: number
}

/**
 * Walk the contiguous run of central-directory records anchored by one EOCD
 * candidate. The run — not the candidate's declared entry count — is what a
 * per-signature parser allocates, so a lied count can neither hide records nor
 * inflate the tally. Returns `null` when the candidate is unresolvable or when
 * the run length disagrees with the declared count: an inconsistent record is
 * suspicious (an empty EOCD appended after a real central directory has exactly
 * this shape) and must never be read as "empty archive". Stops early, and skips
 * the consistency check, once the running total exceeds the limit — the archive
 * is already over budget under this interpretation. Runs are memoized by central
 * directory offset, so many candidates aimed at one directory cost one walk.
 */
function walkCentralDirectory(
  buffer: Buffer,
  eocdOffset: number,
  abortAboveBytes: number,
  runCache: Map<number, CentralDirectoryWalk>
): CentralDirectoryWalk | null {
  const location = locateCentralDirectory(buffer, eocdOffset)
  if (!location) {
    return null
  }

  const cached = runCache.get(location.offset)
  if (cached) {
    return cached.entryCount === location.entryCount ? cached : null
  }

  let entryCount = 0
  let declaredUncompressedBytes = 0
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
    declaredUncompressedBytes += readUncompressedSize(
      buffer,
      cursor,
      fileNameLength,
      extraFieldLength
    )
    if (declaredUncompressedBytes > abortAboveBytes) {
      return { entryCount, declaredUncompressedBytes, totalExtraFieldBytes }
    }

    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  const walk = { entryCount, declaredUncompressedBytes, totalExtraFieldBytes }
  runCache.set(location.offset, walk)
  return entryCount === location.entryCount ? walk : null
}

interface ArchiveInspection {
  /** Worst case across resolvable EOCD interpretations, or `null` when none resolved. */
  worst: CentralDirectoryWalk | null
  /** Whether the scan window held at least one EOCD signature. */
  sawEocdSignature: boolean
}

/**
 * Evaluate the archive under every EOCD candidate and return the worst case of
 * each measure. yauzl, JSZip and SheetJS each select their own EOCD record, so
 * the guard must not depend on guessing which one the downstream parser reads:
 * if ANY interpretation is over budget, the archive is rejected.
 *
 * `worst` is `null` when no candidate resolves. `sawEocdSignature` separates the
 * two ways that happens: a buffer with no EOCD signature at all is simply not a
 * ZIP (legacy binary `.xls`/`.doc`, misidentified plaintext), while a buffer
 * that carries an EOCD signature the guard cannot follow is unverifiable and
 * must be refused — see {@link assertOoxmlArchiveWithinLimits}.
 */
function inspectArchive(buffer: Buffer, abortAboveBytes: number): ArchiveInspection {
  if (buffer.length < EOCD_MIN_SIZE) {
    return { worst: null, sawEocdSignature: false }
  }

  const { candidates, sawSignature } = findEocdCandidates(buffer)

  let worst: CentralDirectoryWalk | null = null
  const runCache = new Map<number, CentralDirectoryWalk>()
  for (const candidate of candidates) {
    const walk = walkCentralDirectory(buffer, candidate, abortAboveBytes, runCache)
    if (!walk) {
      continue
    }
    worst = worst
      ? {
          entryCount: Math.max(worst.entryCount, walk.entryCount),
          declaredUncompressedBytes: Math.max(
            worst.declaredUncompressedBytes,
            walk.declaredUncompressedBytes
          ),
          totalExtraFieldBytes: Math.max(worst.totalExtraFieldBytes, walk.totalExtraFieldBytes),
        }
      : walk
    if (worst.declaredUncompressedBytes > abortAboveBytes) {
      break
    }
  }

  return { worst, sawEocdSignature: sawSignature }
}

/** Parse-time shape of a ZIP central directory, read without decompressing anything. */
export interface ZipCentralDirectoryStats {
  /** Records in the contiguous central-directory run — what a per-signature parser allocates. */
  entryCount: number
  /** Summed declared extra-field bytes across those records. */
  totalExtraFieldBytes: number
}

/**
 * Walk the central directory (EOCD-anchored, decoy-resistant, ZIP64-aware — the
 * same anchoring as {@link assertOoxmlArchiveWithinLimits}) and report the
 * worst-case record count and summed extra-field bytes across every EOCD
 * interpretation, so callers can bound a parser's object graph before handing
 * it the buffer. Each walk covers the CONTIGUOUS run of records at the central
 * directory offset rather than trusting the EOCD's declared count, because that
 * run is what JSZip actually allocates one entry per. Unlike a raw whole-buffer
 * signature scan, STORED entry payloads (e.g. a nested `.zip` archived without
 * recompression) are never miscounted as records. Returns `null` when no EOCD
 * candidate resolves, so callers can fail closed.
 */
export function readZipCentralDirectoryStats(buffer: Buffer): ZipCentralDirectoryStats | null {
  const { worst } = inspectArchive(buffer, Number.POSITIVE_INFINITY)
  if (!worst) {
    return null
  }
  return { entryCount: worst.entryCount, totalExtraFieldBytes: worst.totalExtraFieldBytes }
}

/**
 * Reject an OOXML archive whose declared expanded size or compression ratio
 * exceeds safe bounds, before any decompression library materializes it.
 *
 * The limits are applied to the WORST case across every EOCD interpretation of
 * the buffer, not to one chosen record: the libraries downstream do not agree on
 * which EOCD they read, so an archive that is a bomb under any of them is
 * rejected.
 *
 * Fails closed on two shapes, so a buffer a downstream library still inflates
 * cannot bypass the guard:
 *
 * - The buffer begins with a ZIP signature but no central directory resolves.
 * - The buffer carries an EOCD signature that resolves to nothing. This is the
 *   prepended-bytes evasion: JSZip tolerates arbitrary leading data, but the
 *   EOCD's `cdOffset` is absolute, so shifting the archive by even one byte
 *   makes every candidate unwalkable while the archive still inflates. Keying
 *   the fail-closed branch on the leading signature alone let a 1.2 GiB bomb
 *   through. A buffer holding an EOCD record the guard cannot follow is the
 *   shape of an evasion attempt, not of a non-ZIP file, so it is refused
 *   regardless of what byte 0 says. A non-ZIP document that happens to contain
 *   the four EOCD bytes in its trailing 64 KiB is also refused; that costs one
 *   parse with an explicit error, against an OOM that takes down every tenant
 *   on the worker.
 *
 * Genuinely non-ZIP inputs (legacy OLE `.xls`/`.doc`, misidentified plaintext)
 * carry no EOCD signature, so they no-op and defer to the downstream parser's
 * own validation and fallbacks.
 */
export function assertOoxmlArchiveWithinLimits(
  buffer: Buffer,
  limits: OoxmlSizeLimits = DEFAULT_OOXML_SIZE_LIMITS
): void {
  const { worst, sawEocdSignature } = inspectArchive(buffer, limits.maxTotalUncompressedBytes)
  const totalUncompressed = worst ? worst.declaredUncompressedBytes : null
  if (totalUncompressed === null) {
    if (sawEocdSignature || isZipShaped(buffer)) {
      logger.warn('Rejected archive: central directory could not be parsed', {
        compressedBytes: buffer.length,
        sawEocdSignature,
        zipShaped: isZipShaped(buffer),
      })
      throw new ZipBombError(
        'Unable to inspect ZIP central directory; refusing to parse an unverifiable ZIP-shaped archive'
      )
    }
    return
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
}
