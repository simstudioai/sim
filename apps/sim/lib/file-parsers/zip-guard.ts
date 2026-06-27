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

const EOCD_MIN_SIZE = 22
const ZIP64_EOCD_LOCATOR_SIZE = 20
const CENTRAL_DIRECTORY_HEADER_MIN_SIZE = 46
const MAX_EOCD_COMMENT_SIZE = 0xffff
const UINT32_SENTINEL = 0xffffffff
const UINT16_SENTINEL = 0xffff

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
function isZipShaped(buffer: Buffer): boolean {
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

/**
 * Sum the declared uncompressed size of every central-directory entry. Returns
 * `null` when the buffer is not a parseable ZIP archive (e.g. legacy binary
 * `.xls`/`.doc`, or a misidentified plaintext file) so the caller can defer to
 * the downstream parser. Stops early once the running total exceeds the limit.
 */
function sumDeclaredUncompressedSize(buffer: Buffer, abortAboveBytes: number): number | null {
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
  let cursor = location.offset
  for (let entry = 0; entry < location.entryCount; entry++) {
    if (cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE > buffer.length) {
      return null
    }
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      return null
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraFieldLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)

    total += readUncompressedSize(buffer, cursor, fileNameLength, extraFieldLength)
    if (total > abortAboveBytes) {
      return total
    }

    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  return total
}

/**
 * Reject an OOXML archive whose declared expanded size or compression ratio
 * exceeds safe bounds, before any decompression library materializes it.
 *
 * Fails closed: a ZIP-shaped buffer whose central directory cannot be parsed is
 * rejected rather than passed through, so a malformed archive that a downstream
 * library still inflates cannot bypass the guard. Genuinely non-ZIP inputs
 * (legacy OLE `.xls`/`.doc`, misidentified plaintext) no-op and defer to the
 * downstream parser's own validation and fallbacks.
 */
export function assertOoxmlArchiveWithinLimits(
  buffer: Buffer,
  limits: OoxmlSizeLimits = DEFAULT_OOXML_SIZE_LIMITS
): void {
  const totalUncompressed = sumDeclaredUncompressedSize(buffer, limits.maxTotalUncompressedBytes)
  if (totalUncompressed === null) {
    if (isZipShaped(buffer)) {
      logger.warn('Rejected ZIP-shaped archive: central directory could not be parsed', {
        compressedBytes: buffer.length,
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
