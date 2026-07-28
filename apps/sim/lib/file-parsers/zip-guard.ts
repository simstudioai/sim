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
const UINT32_SENTINEL = 0xffffffff
const UINT16_SENTINEL = 0xffff

/**
 * Ceiling on EOCD signatures considered. A real archive has one (plus, rarely, a
 * stray match inside entry data); a buffer stuffed with more is an attempt to
 * flood the candidate set, and is refused outright.
 */
const MAX_EOCD_CANDIDATES = 128

/**
 * Ceiling on central-directory records read across ALL candidate walks in one
 * inspection.
 *
 * The per-candidate run cache is keyed by central-directory offset, so an
 * attacker who varies `cdOffset` per candidate defeats it and pays
 * `MAX_EOCD_CANDIDATES × buffer.length / 46` record reads: 551 ms of synchronous
 * event-loop block on a 64 MiB buffer and 1006 ms at the pipeline's 100 MiB cap,
 * measured. The budget bounds that at 5.9 ms and 8.6 ms respectively while
 * sitting far above any real archive — the upload path separately refuses more
 * than 10k records. Exhausting it means the buffer could not be fully evaluated,
 * which fails closed like any other unverifiable ZIP-shaped input.
 *
 * Widening the signature scan from the trailing 64 KiB to the whole buffer costs
 * one `Buffer.indexOf` pass: 0.02 ms to 0.33 ms on a normal 5 MB OOXML.
 */
const MAX_CENTRAL_DIRECTORY_RECORDS_SCANNED = 250_000

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
  /** Offsets to evaluate; empty when the buffer is flooded past {@link MAX_EOCD_CANDIDATES}. */
  candidates: number[]
  /** Whether the buffer holds at least one EOCD signature, flooded or not. */
  sawSignature: boolean
}

/**
 * Every EOCD signature offset in the WHOLE buffer.
 *
 * The spec puts the record in the trailing 22 + 65535 comment-length window, and
 * yauzl honours that — but the libraries this guard actually protects do not.
 * JSZip (`ArrayReader.lastIndexOfSignature`) and SheetJS both scan from the last
 * byte to offset 0, so an EOCD pushed past 64 KiB of trailing junk is invisible
 * to a windowed scan yet is exactly the record they parse. Combined with a single
 * prepended byte — which makes the buffer read as "not ZIP-shaped" — a windowed
 * scan let a 495x bomb through untouched. The guard models the parsers, not the
 * spec, so the window is the buffer.
 *
 * Trailing bytes after the EOCD are common in the wild (self-extracting stubs,
 * appended signatures, generator padding), so the record is not required to end
 * at the buffer tail. Every candidate is returned rather than the first that
 * looks plausible: the decompression libraries each pick their own record, so the
 * archive is evaluated under all of them. A flooded buffer yields no candidates
 * but still reports the signature, so the caller refuses the buffer rather than
 * reading it as "not a ZIP".
 */
function findEocdCandidates(buffer: Buffer): EocdScan {
  const lastOffset = buffer.length - EOCD_MIN_SIZE
  const candidates: number[] = []
  let sawSignature = false

  let offset = buffer.indexOf(EOCD_SIGNATURE_BYTES)
  while (offset !== -1) {
    sawSignature = true
    if (offset > lastOffset) {
      break
    }
    if (candidates.length >= MAX_EOCD_CANDIDATES) {
      return { candidates: [], sawSignature: true }
    }
    candidates.push(offset)
    offset = buffer.indexOf(EOCD_SIGNATURE_BYTES, offset + 1)
  }

  return { candidates, sawSignature }
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
 *
 * The extra-field extent is clamped to the buffer: a truncated central directory
 * can declare a length that runs off the end, and an unclamped read raises a raw
 * `RangeError` that escapes callers which expect a typed archive error.
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
  const extraEnd = Math.min(extraStart + extraFieldLength, buffer.length)
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
 * A candidate is either ignorable, unverifiable, or measurable.
 *
 * - `ignored` — the EOCD's `cdOffset` does not resolve at all (out of range, or a
 *   broken ZIP64 chain). No parser can read a central directory from it, and a
 *   stray `PK\x05\x06` inside compressed entry data lands here, so it carries no
 *   signal either way.
 * - `unverifiable` — the offset resolves and the record declares entries, but not
 *   one record sits there. This is the prepended-bytes shape: JSZip rebases past
 *   arbitrary leading data and inflates the archive anyway, while every absolute
 *   offset in the buffer is shifted out from under the guard. It must fail closed.
 * - `walk` — records were read; the run is the measurement.
 */
type CandidateOutcome =
  | { kind: 'ignored' }
  | { kind: 'unverifiable' }
  | { kind: 'walk'; walk: CentralDirectoryWalk }

/** Remaining central-directory records an inspection may read, shared across candidates. */
interface ScanBudget {
  remaining: number
}

/**
 * Walk the contiguous run of central-directory records anchored by one EOCD
 * candidate. The run — not the candidate's declared entry count — is what a
 * per-signature parser allocates, so a lied count can neither hide records nor
 * inflate the tally.
 *
 * A run that disagrees with the declared count is still measured. JSZip
 * deliberately does not error on a count mismatch ("we found some records but not
 * all… no error here", `zipEntries.js`), so it allocates and inflates exactly the
 * run found here; discarding the candidate instead measured NOTHING for that
 * interpretation and let a 1021x bomb through behind a single decoy record.
 *
 * Stops early once the running total exceeds the limit — the archive is already
 * over budget under this interpretation — or once the shared scan budget is
 * exhausted, which is reported as unverifiable rather than as a short run. Runs
 * are memoized by central directory offset, so many candidates aimed at one
 * directory cost one walk.
 */
function walkCentralDirectory(
  buffer: Buffer,
  eocdOffset: number,
  abortAboveBytes: number,
  runCache: Map<number, CentralDirectoryWalk>,
  budget: ScanBudget
): CandidateOutcome {
  const location = locateCentralDirectory(buffer, eocdOffset)
  if (!location) {
    return { kind: 'ignored' }
  }

  const cached = runCache.get(location.offset)
  if (cached) {
    return classifyRun(cached, location)
  }

  let entryCount = 0
  let declaredUncompressedBytes = 0
  let totalExtraFieldBytes = 0
  let cursor = location.offset
  while (
    cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE <= buffer.length &&
    buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    if (budget.remaining <= 0) {
      return { kind: 'unverifiable' }
    }
    budget.remaining -= 1

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
      return { kind: 'walk', walk: { entryCount, declaredUncompressedBytes, totalExtraFieldBytes } }
    }

    cursor += CENTRAL_DIRECTORY_HEADER_MIN_SIZE + fileNameLength + extraFieldLength + commentLength
  }

  const walk = { entryCount, declaredUncompressedBytes, totalExtraFieldBytes }
  runCache.set(location.offset, walk)
  return classifyRun(walk, location)
}

/**
 * An empty run under a record that declares entries means the directory is not
 * where the buffer says it is — unverifiable. An empty run under a record that
 * declares nothing is simply an empty archive, and is measured as such.
 */
function classifyRun(
  walk: CentralDirectoryWalk,
  location: CentralDirectoryLocation
): CandidateOutcome {
  if (walk.entryCount === 0 && location.entryCount > 0) {
    return { kind: 'unverifiable' }
  }
  return { kind: 'walk', walk }
}

interface ArchiveInspection {
  /** Worst case across measurable EOCD interpretations, or `null` when none were. */
  worst: CentralDirectoryWalk | null
  /** Whether the buffer held at least one EOCD signature. */
  sawEocdSignature: boolean
  /**
   * Whether the buffer holds an EOCD signal the guard could not evaluate: a
   * record naming a directory that is not there, a directory too large to scan
   * within the budget, or a candidate set too flooded to enumerate. Distinct
   * from "no measurement" — an EOCD whose offset lands outside the buffer is
   * unreadable by every parser too, so it is no signal rather than a bad one.
   */
  sawUnverifiableEocd: boolean
}

/**
 * Evaluate the archive under every EOCD candidate and return the worst case of
 * each measure. yauzl, JSZip and SheetJS each select their own EOCD record, so
 * the guard must not depend on guessing which one the downstream parser reads:
 * if ANY interpretation is over budget, the archive is rejected.
 *
 * `worst` is `null` when nothing was measurable — which alone is not grounds for
 * refusal, since a non-ZIP document carrying the four EOCD bytes by chance lands
 * here. `sawUnverifiableEocd` is the separate, convicting signal: a candidate the
 * guard cannot follow is an evasion shape that must be refused even when another
 * candidate measured cleanly — see {@link assertOoxmlArchiveWithinLimits}.
 */
function inspectArchive(buffer: Buffer, abortAboveBytes: number): ArchiveInspection {
  if (buffer.length < EOCD_MIN_SIZE) {
    return { worst: null, sawEocdSignature: false, sawUnverifiableEocd: false }
  }

  const { candidates, sawSignature } = findEocdCandidates(buffer)

  let worst: CentralDirectoryWalk | null = null
  // A signature the scan declined to enumerate — a flooded buffer, or a record
  // truncated by the buffer end — is unevaluated, not absent. JSZip reads the
  // LAST signature in the buffer, so flooding past the candidate ceiling would
  // otherwise hide the one record it actually parses.
  let sawUnverifiableEocd = sawSignature && candidates.length === 0
  const runCache = new Map<number, CentralDirectoryWalk>()
  const budget: ScanBudget = { remaining: MAX_CENTRAL_DIRECTORY_RECORDS_SCANNED }
  for (const candidate of candidates) {
    const outcome = walkCentralDirectory(buffer, candidate, abortAboveBytes, runCache, budget)
    if (outcome.kind === 'unverifiable') {
      sawUnverifiableEocd = true
      break
    }
    if (outcome.kind === 'ignored') {
      continue
    }
    const { walk } = outcome
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

  return { worst, sawEocdSignature: sawSignature, sawUnverifiableEocd }
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
 * candidate is measurable or when any candidate is unverifiable, so callers can
 * fail closed.
 */
export function readZipCentralDirectoryStats(buffer: Buffer): ZipCentralDirectoryStats | null {
  const { worst, sawUnverifiableEocd } = inspectArchive(buffer, Number.POSITIVE_INFINITY)
  if (!worst || sawUnverifiableEocd) {
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
 * Fails closed on two families of shape, so a buffer a downstream library still
 * inflates cannot bypass the guard:
 *
 * - The buffer is ZIP-shaped (byte 0 begins a local file header or an EOCD) but
 *   nothing measurable resolves.
 * - The buffer holds an EOCD signal the guard could not evaluate, whatever byte
 *   0 says. Three cases: a record that names a directory offset inside the
 *   buffer where no record is found; a directory too large to scan within the
 *   shared record budget; and a signature the scan declined to enumerate at all
 *   — a candidate set flooded past {@link MAX_EOCD_CANDIDATES}, or a record
 *   truncated by the buffer end. JSZip parses the LAST signature in the buffer,
 *   so flooding would otherwise hide exactly the one record it reads.
 *
 *   The first case is the prepended-bytes evasion: JSZip tolerates arbitrary
 *   leading data, but the EOCD's `cdOffset` is absolute, so shifting the archive
 *   by even one byte leaves the record naming an offset that no longer holds a
 *   directory, while the archive still inflates. Keying the fail-closed branch
 *   on the leading signature alone let a 1.2 GiB bomb through. The refusal holds
 *   even when another candidate measures cleanly: an empty 22-byte EOCD appended
 *   as a decoy is trivially measurable, and letting it stand in for the shifted
 *   record reopens the same hole.
 *
 * An EOCD signature whose `cdOffset` lands OUTSIDE the buffer is not a signal in
 * either direction — no parser can read a directory from it — so it neither
 * measures nor convicts. This is the common case for the four bytes appearing by
 * chance in a legacy OLE `.doc`/`.xls` or in plaintext, and those inputs must
 * no-op so the downstream parsers' own fallback paths can run. Treating any
 * stray signature as grounds for refusal turned a legacy `.doc` into a hard
 * error. What remains is the ~1e-6 case of a stray whose offset happens to land
 * in range and read empty; that costs one parse with an explicit error, against
 * an OOM that takes down every tenant on the worker.
 */
export function assertOoxmlArchiveWithinLimits(
  buffer: Buffer,
  limits: OoxmlSizeLimits = DEFAULT_OOXML_SIZE_LIMITS
): void {
  const { worst, sawEocdSignature, sawUnverifiableEocd } = inspectArchive(
    buffer,
    limits.maxTotalUncompressedBytes
  )
  const totalUncompressed = worst ? worst.declaredUncompressedBytes : null
  if (totalUncompressed === null || sawUnverifiableEocd) {
    if (sawUnverifiableEocd || isZipShaped(buffer)) {
      logger.warn('Rejected archive: central directory could not be parsed', {
        compressedBytes: buffer.length,
        sawEocdSignature,
        sawUnverifiableEocd,
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
