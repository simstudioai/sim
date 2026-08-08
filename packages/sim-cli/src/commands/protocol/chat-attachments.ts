import { execFile } from 'node:child_process'
import { type FileHandle, mkdtemp, open, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { SimApiError } from '../../http/client.js'

export interface ChatAttachment {
  name: string
  mediaType: string
  data: string
}

export const MAX_CHAT_ATTACHMENTS = 5
export const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024
export const MAX_CHAT_TEXT_ATTACHMENT_BYTES = 200 * 1024
export const MAX_CHAT_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024

const execFileAsync = promisify(execFile)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const TEXT_MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.jsx': 'text/javascript',
  '.log': 'text/plain',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.ndjson': 'application/x-ndjson',
  '.toml': 'application/toml',
  '.ts': 'text/typescript',
  '.tsv': 'text/tab-separated-values',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

function attachmentError(message: string): SimApiError {
  return new SimApiError(message, 0)
}

function sniffImageMediaType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6) {
    const signature = Buffer.from(bytes.subarray(0, 6)).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF')
}

function assertAttachmentName(name: string): void {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  ) {
    throw attachmentError(`Attachment name ${JSON.stringify(name)} must be a safe file basename.`)
  }
}

function textMediaType(path: string): string {
  return TEXT_MEDIA_TYPES_BY_EXTENSION[extname(path).toLowerCase()] ?? 'text/plain'
}

function inspectAttachment(path: string, bytes: Uint8Array): { mediaType: string; limit: number } {
  const imageMediaType = sniffImageMediaType(bytes)
  if (imageMediaType) return { mediaType: imageMediaType, limit: MAX_CHAT_ATTACHMENT_BYTES }
  if (isPdf(bytes)) return { mediaType: 'application/pdf', limit: MAX_CHAT_ATTACHMENT_BYTES }

  try {
    const value = utf8Decoder.decode(bytes)
    if (value.includes('\0')) throw new Error('NUL byte')
  } catch {
    throw attachmentError(
      `Unsupported attachment ${JSON.stringify(basename(path))}. Use PNG, JPEG, GIF, WebP, PDF, or UTF-8 text.`
    )
  }
  return { mediaType: textMediaType(path), limit: MAX_CHAT_TEXT_ATTACHMENT_BYTES }
}

async function readBounded(handle: FileHandle, limit: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(limit + 1)
  let offset = 0
  while (offset < bytes.byteLength) {
    const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return bytes.subarray(0, offset)
}

/** Reads and validates one local file without ever putting its path on the wire. */
export async function loadChatAttachment(path: string): Promise<ChatAttachment> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch {
    throw attachmentError(`Could not read attachment ${JSON.stringify(path)}.`)
  }

  const name = basename(path)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw attachmentError(`Attachment ${JSON.stringify(path)} is not a file.`)
    // Metadata rejects obvious mistakes without allocating for them. The read
    // itself is independently capped because a file can grow after fstat.
    if (info.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw attachmentError(`Attachment ${JSON.stringify(name)} exceeds the 5 MiB limit.`)
    }

    assertAttachmentName(name)
    const bytes = await readBounded(handle, MAX_CHAT_ATTACHMENT_BYTES)
    if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
      throw attachmentError(`Attachment ${JSON.stringify(name)} exceeds the 5 MiB limit.`)
    }
    if (bytes.byteLength === 0) {
      throw attachmentError(`Attachment ${JSON.stringify(name)} is empty.`)
    }
    const { mediaType, limit } = inspectAttachment(path, bytes)
    if (bytes.byteLength > limit) {
      const label = limit === MAX_CHAT_TEXT_ATTACHMENT_BYTES ? '200 KiB' : '5 MiB'
      throw attachmentError(`Attachment ${JSON.stringify(name)} exceeds the ${label} limit.`)
    }

    return { name, mediaType, data: bytes.toString('base64') }
  } catch (error) {
    if (error instanceof SimApiError) throw error
    throw attachmentError(`Could not read attachment ${JSON.stringify(path)}.`)
  } finally {
    await handle.close().catch(() => {})
  }
}

export function decodedAttachmentBytes(attachment: ChatAttachment): number {
  return Buffer.from(attachment.data, 'base64').byteLength
}

/** Enforces count and aggregate limits whenever pending attachments are combined. */
export function combineChatAttachments(
  current: ChatAttachment[],
  additions: ChatAttachment[]
): ChatAttachment[] {
  const combined = [...current, ...additions]
  if (combined.length > MAX_CHAT_ATTACHMENTS) {
    throw attachmentError(`Sim Chat accepts at most ${MAX_CHAT_ATTACHMENTS} attachments per turn.`)
  }
  const bytes = combined.reduce((total, item) => total + decodedAttachmentBytes(item), 0)
  if (bytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
    throw attachmentError('Sim Chat attachments exceed the 10 MiB aggregate limit.')
  }
  return combined
}

export async function loadChatAttachments(paths: string[]): Promise<ChatAttachment[]> {
  if (paths.length > MAX_CHAT_ATTACHMENTS) {
    throw attachmentError(`Sim Chat accepts at most ${MAX_CHAT_ATTACHMENTS} attachments per turn.`)
  }

  const attachments: ChatAttachment[] = []
  let totalBytes = 0
  for (const path of paths) {
    const attachment = await loadChatAttachment(path)
    totalBytes += decodedAttachmentBytes(attachment)
    if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
      throw attachmentError('Sim Chat attachments exceed the 10 MiB aggregate limit.')
    }
    attachments.push(attachment)
  }
  return attachments
}

/**
 * Splits `/attach` input using the subset terminals produce for dragged paths:
 * whitespace separation, single/double quotes, and backslash escapes.
 */
export function parseAttachmentPaths(input: string): string[] {
  const paths: string[] = []
  let value = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false

  const push = () => {
    if (value) paths.push(value)
    value = ''
  }

  for (const character of input.trim()) {
    if (escaped) {
      value += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      continue
    }
    if (/\s/.test(character) && quote === null) {
      push()
      continue
    }
    value += character
  }

  if (escaped) value += '\\'
  if (quote !== null) throw attachmentError('Unclosed quote in attachment path.')
  push()
  return paths
}

/**
 * Writes the clipboard image to a path given as argv[1].
 *
 * Deliberately performs no size check: AppleScript cannot take `length of` raw
 * data ("Can't make length of «data PNGf…»"), so a guard here throws for every
 * image and the whole read fails. `loadChatAttachment` caps the size on fstat
 * and again on read, which is where the limit belongs anyway.
 */
const APPLE_SCRIPT = [
  'on run argv',
  'set outputPath to item 1 of argv',
  'try',
  'set imageData to the clipboard as «class PNGf»',
  'set outputFile to open for access POSIX file outputPath with write permission',
  'set eof outputFile to 0',
  'write imageData to outputFile',
  'close access outputFile',
  'on error',
  'try',
  'close access POSIX file outputPath',
  'end try',
  'error number -1700',
  'end try',
  'end run',
]

/** Best-effort macOS clipboard image extraction, used by the paste keystroke. */
export async function readClipboardImage(): Promise<ChatAttachment | null> {
  if (process.platform !== 'darwin') return null

  const directory = await mkdtemp(join(tmpdir(), 'sim-chat-clipboard-'))
  const path = join(directory, 'clipboard.png')
  try {
    const args = APPLE_SCRIPT.flatMap((line) => ['-e', line])
    args.push(path)
    await execFileAsync('osascript', args, { timeout: 5_000 })
    return await loadChatAttachment(path)
  } catch {
    return null
  } finally {
    await unlink(path).catch(() => {})
    await rmdir(directory).catch(() => {})
  }
}

/** True when every parsed path names an existing regular file. */
export async function existingAttachmentPaths(input: string): Promise<string[] | null> {
  let wholePath
  try {
    wholePath = await stat(input.trim())
  } catch {
    wholePath = null
  }
  if (wholePath?.isFile()) return [input.trim()]

  let paths: string[]
  try {
    paths = parseAttachmentPaths(input)
  } catch {
    return null
  }
  if (paths.length === 0 || paths.length > MAX_CHAT_ATTACHMENTS) return null
  for (const path of paths) {
    try {
      if (!(await stat(path)).isFile()) return null
    } catch {
      return null
    }
  }
  return paths
}
