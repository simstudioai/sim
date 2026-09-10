import { FileParserError } from '@/lib/file-parsers/errors'
import { decodeTextBuffer, detectBomlessUtf16 } from '@/lib/file-parsers/utils'
import { isZipShaped } from '@/lib/file-parsers/zip-guard'

/**
 * What the bytes of a buffer look like, independent of the caller-supplied
 * extension. `zip` is a ZIP archive that is none of the recognized Office
 * containers; `ole2` is any OLE compound file (legacy `.doc`/`.xls`/`.ppt`).
 */
export type SniffedKind =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'zip'
  | 'ole2'
  | 'rtf'
  | 'html'
  | 'text'
  | 'binary'

const PDF_HEAD_WINDOW = 1024
const TEXT_HEAD_WINDOW = 4096
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1')
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
/** An RTF file is a group opening with the `rtf` control word; nothing may precede it. */
const RTF_SIGNATURE = Buffer.from('{\\rtf', 'latin1')

const EOCD_SIGNATURE = 0x06054b50
const EOCD_MIN_SIZE = 22
const MAX_EOCD_COMMENT_SIZE = 0xffff
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_LOCATOR_SIZE = 20
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50
const CENTRAL_DIRECTORY_HEADER_MIN_SIZE = 46
const LOCAL_FILE_HEADER_MIN_SIZE = 30
const COMPRESSION_METHOD_STORED = 0
const UINT16_SENTINEL = 0xffff
const UINT32_SENTINEL = 0xffffffff
/** Enough to reach the first `word/`, `xl/` or `ppt/` part in any real package. */
const MAX_INSPECTED_ENTRIES = 256
const MAX_MIMETYPE_BYTES = 128

const ODF_MIMETYPES: Record<string, 'odt' | 'ods' | 'odp'> = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
}

interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

/** Same EOCD anchoring as the zip guard: only a record whose comment ends the buffer counts. */
function findEocdOffset(buffer: Buffer): number {
  const minStart = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_EOCD_COMMENT_SIZE)
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= minStart; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + EOCD_MIN_SIZE + commentLength === buffer.length) return offset
  }
  return -1
}

function locateCentralDirectory(buffer: Buffer, eocdOffset: number): number | null {
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (entryCount !== UINT16_SENTINEL && directoryOffset !== UINT32_SENTINEL) {
    return directoryOffset
  }

  const locatorOffset = eocdOffset - ZIP64_EOCD_LOCATOR_SIZE
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
    return null
  }
  const zip64Eocd = buffer.readBigUInt64LE(locatorOffset + 8)
  if (zip64Eocd > BigInt(buffer.length - 56)) return null
  const zip64EocdOffset = Number(zip64Eocd)
  if (buffer.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE) return null
  const zip64DirectoryOffset = buffer.readBigUInt64LE(zip64EocdOffset + 48)
  if (zip64DirectoryOffset > BigInt(buffer.length)) return null
  return Number(zip64DirectoryOffset)
}

/**
 * Reads central-directory entry names without decompressing anything. Returns
 * `null` for a buffer whose directory cannot be located. Bounded to the first
 * {@link MAX_INSPECTED_ENTRIES} records so a large archive costs no more than a
 * small one.
 */
function readZipEntries(buffer: Buffer): ZipEntry[] | null {
  if (buffer.length < EOCD_MIN_SIZE) return null
  const eocdOffset = findEocdOffset(buffer)
  if (eocdOffset < 0) return null
  const directoryOffset = locateCentralDirectory(buffer, eocdOffset)
  if (directoryOffset === null) return null

  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  while (
    entries.length < MAX_INSPECTED_ENTRIES &&
    cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE <= buffer.length &&
    buffer.readUInt32LE(cursor) === CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraFieldLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const nameStart = cursor + CENTRAL_DIRECTORY_HEADER_MIN_SIZE
    if (nameStart + fileNameLength > buffer.length) break
    entries.push({
      name: buffer.toString('utf8', nameStart, nameStart + fileNameLength),
      compressionMethod: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      localHeaderOffset: buffer.readUInt32LE(cursor + 42),
    })
    cursor = nameStart + fileNameLength + extraFieldLength + commentLength
  }
  return entries
}

/** The stored `mimetype` entry's bytes, which OpenDocument requires to be uncompressed. */
function readStoredEntry(buffer: Buffer, entry: ZipEntry, maxBytes: number): string | null {
  if (entry.compressionMethod !== COMPRESSION_METHOD_STORED || entry.compressedSize > maxBytes) {
    return null
  }
  const headerOffset = entry.localHeaderOffset
  if (headerOffset + LOCAL_FILE_HEADER_MIN_SIZE > buffer.length) return null
  const fileNameLength = buffer.readUInt16LE(headerOffset + 26)
  const extraFieldLength = buffer.readUInt16LE(headerOffset + 28)
  const dataStart = headerOffset + LOCAL_FILE_HEADER_MIN_SIZE + fileNameLength + extraFieldLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.length) return null
  return buffer.toString('latin1', dataStart, dataEnd).trim()
}

function classifyZip(buffer: Buffer): SniffedKind {
  const entries = readZipEntries(buffer)
  if (!entries) return 'zip'

  const mimetypeEntry = entries.find((entry) => entry.name === 'mimetype')
  if (mimetypeEntry) {
    const mimetype = readStoredEntry(buffer, mimetypeEntry, MAX_MIMETYPE_BYTES)
    if (mimetype && mimetype in ODF_MIMETYPES) return ODF_MIMETYPES[mimetype]
  }

  for (const { name } of entries) {
    if (name.startsWith('word/')) return 'docx'
    if (name.startsWith('xl/')) return 'xlsx'
    if (name.startsWith('ppt/')) return 'pptx'
  }
  return 'zip'
}

function hasUtf16Bom(head: Buffer): boolean {
  return (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  )
}

function sniffTextKind(buffer: Buffer): SniffedKind {
  const head = buffer.subarray(0, TEXT_HEAD_WINDOW)
  if (head.includes(0) && !hasUtf16Bom(head) && detectBomlessUtf16(head) === null) {
    return 'binary'
  }

  const leading = decodeTextBuffer(head).text.trimStart().slice(0, 16).toLowerCase()
  if (leading.startsWith('<!doctype html') || leading.startsWith('<html')) return 'html'
  return 'text'
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Whether the PDF header is the first thing in the buffer, allowing only a UTF-8
 * BOM and ASCII whitespace before it.
 */
function startsWithPdfSignature(buffer: Buffer): boolean {
  let offset = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) ? UTF8_BOM.length : 0
  while (offset < buffer.length && offset < PDF_HEAD_WINDOW) {
    const byte = buffer[offset]
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break
    offset++
  }
  return buffer.subarray(offset, offset + PDF_SIGNATURE.length).equals(PDF_SIGNATURE)
}

/**
 * Identifies a buffer from its bytes: magic numbers first (PDF, OLE2, ZIP), then
 * the ZIP's central directory for the Office and OpenDocument containers, then a
 * text heuristic on the first 4 KiB. Never throws and never decompresses.
 *
 * pdf.js tolerates junk before the PDF header, so a declared `.pdf` is searched
 * through its first KiB for the signature. Under any other (or no) declared
 * extension the header must be at the start, so a text file that merely mentions
 * `%PDF-1.4` is not mistaken for a PDF.
 */
export function sniffFileKind(buffer: Buffer, declaredExtension?: string): SniffedKind {
  const isPdf =
    declaredExtension === 'pdf'
      ? buffer.subarray(0, PDF_HEAD_WINDOW).indexOf(PDF_SIGNATURE) !== -1
      : startsWithPdfSignature(buffer)
  if (isPdf) return 'pdf'
  if (buffer.length >= OLE2_SIGNATURE.length && buffer.subarray(0, 8).equals(OLE2_SIGNATURE)) {
    return 'ole2'
  }
  if (isZipShaped(buffer)) return classifyZip(buffer)
  if (buffer.subarray(0, RTF_SIGNATURE.length).equals(RTF_SIGNATURE)) return 'rtf'
  return sniffTextKind(buffer)
}

/** The container family an extension promises, so a mismatch can be reconciled. */
export type ExtensionFamily =
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'presentation'
  | 'opendocument'
  | 'ole'
  | 'text'

const EXTENSION_FAMILIES: Record<string, ExtensionFamily> = {
  pdf: 'pdf',
  docx: 'word',
  docm: 'word',
  dotx: 'word',
  xlsx: 'sheet',
  xls: 'sheet',
  xlsm: 'sheet',
  xlsb: 'sheet',
  xltx: 'sheet',
  ods: 'sheet',
  pptx: 'presentation',
  pptm: 'presentation',
  potx: 'presentation',
  odt: 'opendocument',
  odp: 'opendocument',
  doc: 'ole',
  txt: 'text',
  md: 'text',
  csv: 'text',
  json: 'text',
  jsonl: 'text',
  yaml: 'text',
  yml: 'text',
  html: 'text',
  htm: 'text',
}

/** Sniffed kinds that are exactly what each family's parsers read. */
const FAMILY_ACCEPTS: Record<ExtensionFamily, ReadonlySet<SniffedKind>> = {
  pdf: new Set<SniffedKind>(['pdf']),
  word: new Set<SniffedKind>(['docx']),
  sheet: new Set<SniffedKind>(['xlsx', 'ods', 'ole2']),
  presentation: new Set<SniffedKind>(['pptx']),
  opendocument: new Set<SniffedKind>(['odt', 'odp']),
  ole: new Set<SniffedKind>(['ole2']),
  text: new Set<SniffedKind>(['text', 'html']),
}

/** Sniffed kinds that name their own parser regardless of the extension. */
const KIND_ROUTES: Partial<Record<SniffedKind, string>> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  odt: 'odt',
  ods: 'ods',
  odp: 'odp',
  html: 'html',
}

export interface ParserRoute {
  /** Registry key to parse with — the extension itself when the bytes agree with it. */
  extension: string
  /** Set only when the route differs from the extension. */
  detectedType?: SniffedKind
  warning?: string
}

function invalidFormat(extension: string, kind: SniffedKind): FileParserError {
  return new FileParserError(
    'invalid_format',
    `File content does not match the .${extension} extension (detected ${kind}). Re-save it in a supported format and retry.`
  )
}

/**
 * Reconciles the caller-supplied extension with what the bytes are. Magic wins
 * over the name, as in Tika and unstructured: when the sniffed kind has its own
 * parser the route is overridden and a warning recorded; when it has none and
 * the family disagrees, the buffer is rejected as `invalid_format` rather than
 * fed to a parser that would emit mojibake or placeholder prose.
 *
 * Plain text under a binary extension keeps today's behavior of parsing as
 * text (as CSV under a spreadsheet extension), and an OLE2 file under a modern
 * Word extension is the legacy `.doc` parser's job. Legacy `.ppt` has no reader.
 */
export function reconcileParserRoute(extension: string, kind: SniffedKind): ParserRoute {
  if (kind === 'rtf') {
    throw new FileParserError(
      'unsupported_type',
      'RTF is not supported. Save the file as .docx and retry.'
    )
  }

  const family = EXTENSION_FAMILIES[extension]
  if (!family) return { extension }

  const override = (route: string): ParserRoute => ({
    extension: route,
    detectedType: kind,
    warning: `File content was detected as ${kind}; parsed as .${route} instead of .${extension}`,
  })

  /**
   * Only `.txt` and `.md` may hold a whole HTML document — a `.md` that starts
   * with `<!DOCTYPE html>` is deliberately treated as HTML, since Markdown allows
   * raw HTML and the parser strips the markup either way. Under the structured
   * text extensions an HTML document is an error page saved as data.
   */
  if (kind === 'html' && family === 'text' && extension !== 'html' && extension !== 'htm') {
    if (extension === 'txt' || extension === 'md') return override('html')
    throw invalidFormat(extension, kind)
  }
  if (FAMILY_ACCEPTS[family].has(kind)) return { extension }

  /**
   * Ambiguous bytes stay on the declared route. An archive without a recognised
   * layout may still be a workbook SheetJS reads (`xl/` is a convention, not a
   * rule), and an unknown binary layout under a spreadsheet or legacy Word
   * extension covers raw BIFF streams and other formats those parsers accept.
   * Each of those parsers raises its own typed error when the bytes are not a
   * document, so passing them through never yields scraped garbage.
   */
  if (kind === 'zip' && family !== 'pdf' && family !== 'text') return { extension }
  /**
   * A NUL byte in a declared text file is not proof of a container either: the
   * decoder recognises UTF-16 and Windows-1252 and the sanitizer strips stray
   * NULs, so the text route is kept. Recognised containers under a text
   * extension are still refused below.
   */
  if (kind === 'binary' && (family === 'sheet' || family === 'ole' || family === 'text')) {
    return { extension }
  }

  if (kind === 'text') return override(family === 'sheet' ? 'csv' : 'txt')
  if (kind === 'ole2') {
    if (family === 'word') return override('doc')
    if (family === 'presentation') {
      throw new FileParserError(
        'unsupported_type',
        'Legacy binary PowerPoint (.ppt) files are not supported. Save the file as .pptx and retry.'
      )
    }
    throw invalidFormat(extension, kind)
  }

  const route = KIND_ROUTES[kind]
  if (route) return override(route)
  throw invalidFormat(extension, kind)
}
