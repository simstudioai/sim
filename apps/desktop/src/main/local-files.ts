import { constants } from 'node:fs'
import { lstat, open, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  DesktopLocalFileEntry,
  DesktopLocalFileManifest,
  DesktopLocalFileRead,
  DesktopLocalFileResponse,
} from '@sim/desktop-bridge'
import { MAX_DESKTOP_IMPORT_FILE_BYTES } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { PDFDocument } from 'pdf-lib'
import type { LocalFileAccess } from '@/main/local-filesystem'
import { readNativeDirectory } from '@/main/native-directory'

const CHUNK_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 1000
const MAX_READ_BYTES = 64_000

export interface LocalFileAuthorization {
  toolName: string
  args: Record<string, unknown>
}

function revision(info: Awaited<ReturnType<typeof stat>>): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error(`Expected an integer between 0 and ${max}.`)
  return value
}

function assertImportPath(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error('The file is outside this import source.')
}

async function openApprovedPath(path: string, access: LocalFileAccess, directory = false) {
  const canonical = await access.resolve(path)
  if (canonical !== path)
    throw new Error('The local path changed while it was being opened. Try again.')
  const file = await open(
    canonical,
    constants.O_RDONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK |
      (directory ? constants.O_DIRECTORY : 0)
  )
  try {
    const info = await file.stat()
    const verified = await access.resolve(path)
    const current = await lstat(verified)
    if (
      (directory ? !info.isDirectory() : !info.isFile()) ||
      canonical !== verified ||
      info.dev !== current.dev ||
      info.ino !== current.ino
    )
      throw new Error('The local file changed while it was being opened. Try again.')
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}

async function readApprovedDirectory(path: string, access: LocalFileAccess) {
  const handle = await openApprovedPath(path, access, true)
  try {
    const listing = await readNativeDirectory(handle.fd, MAX_ENTRIES)
    if ((await access.resolve(path)) !== path)
      throw new Error('The local directory changed while it was being read. Try again.')
    listing.entries.sort((left, right) => compareStrings(left.name, right.name))
    return listing
  } finally {
    await handle.close()
  }
}

async function inspect(
  path: string,
  args: Record<string, unknown>,
  access: LocalFileAccess
): Promise<DesktopLocalFileRead> {
  const info = await stat(path)
  if (info.isDirectory()) {
    const { entries, truncated } = await readApprovedDirectory(path, access)
    return {
      kind: 'read',
      path,
      representation: 'directory',
      truncated,
      entries,
    }
  }
  if (!info.isFile()) throw new Error('The path is not a regular file or directory.')
  const file = await openApprovedPath(path, access)
  try {
    const info = await file.stat()
    const header = Buffer.alloc(16)
    await file.read(header, 0, header.length, 0)
    const mediaType = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : header[0] === 255 && header[1] === 216
        ? 'image/jpeg'
        : header.toString('ascii', 0, 3) === 'GIF'
          ? 'image/gif'
          : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
            ? 'image/webp'
            : header.toString('ascii', 0, 5) === '%PDF-'
              ? 'application/pdf'
              : null
    if (mediaType) {
      if (info.size > CHUNK_BYTES)
        throw new Error(
          'Visual files larger than 8 MB must be imported into Workspace Files first.'
        )
      let bytes = Buffer.alloc(info.size)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      bytes = bytes.subarray(0, bytesRead)
      let pageCount: number | undefined
      let truncated = false
      if (mediaType === 'application/pdf') {
        const source = await PDFDocument.load(bytes)
        pageCount = Math.min(source.getPageCount(), 20)
        if (!pageCount) throw new Error('The PDF has no pages.')
        truncated = source.getPageCount() > pageCount
        const subset = await PDFDocument.create()
        for (const page of await subset.copyPages(
          source,
          Array.from({ length: pageCount }, (_, i) => i)
        ))
          subset.addPage(page)
        bytes = Buffer.from(await subset.save())
      }
      if (bytes.length > CHUNK_BYTES)
        throw new Error('The rendered file exceeds the 8 MB visual limit; import it first.')
      return {
        kind: 'read',
        path,
        representation: 'visual',
        truncated,
        observations: [
          {
            name: basename(path),
            mediaType,
            data: bytes.toString('base64'),
            ...(pageCount ? { pageCount } : {}),
          },
        ],
      }
    }
    const offset = boundedInteger(args.offset, 0, Number.MAX_SAFE_INTEGER)
    const limit = boundedInteger(args.limit, MAX_READ_BYTES, MAX_READ_BYTES)
    if (!limit) throw new Error('Read limit must be positive.')
    const buffer = Buffer.alloc(Math.min(limit, Math.max(0, info.size - offset)))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
    const bytes = buffer.subarray(0, bytesRead)
    if (bytes.includes(0))
      return {
        kind: 'read',
        path,
        representation: 'binary',
        note: 'Binary content cannot be decoded as text. Import this file into Workspace Files for document extraction.',
      }
    /** Retain partial characters for the next page; preserving BOM keeps byte offsets exact. */
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, {
        stream: offset + bytesRead < info.size,
      })
    } catch {
      throw new Error('Text reads require valid UTF-8 and an offset at a character boundary.')
    }
    const textBytes = Buffer.byteLength(text)
    if (bytesRead > 0 && textBytes === 0)
      throw new Error('The read limit must fit at least one complete UTF-8 character.')
    return {
      kind: 'read',
      path,
      representation: 'text',
      text,
      offset,
      nextOffset: offset + textBytes,
      truncated: offset + textBytes < info.size,
    }
  } finally {
    await file.close()
  }
}

async function manifest(
  path: string,
  args: Record<string, unknown>,
  access: LocalFileAccess
): Promise<DesktopLocalFileManifest> {
  if (typeof args.targetWorkspaceId !== 'string') throw new Error('A target workspace is required.')
  const root = await access.resolve(path)
  const entries: DesktopLocalFileEntry[] = []
  async function walk(current: string, ancestors: ReadonlySet<string>): Promise<void> {
    if (entries.length >= MAX_ENTRIES)
      throw new Error(
        'The directory exceeds 1,000 entries. Import smaller subdirectories separately.'
      )
    const canonical = await access.resolve(current)
    assertImportPath(root, canonical)
    const info = await stat(canonical)
    if (!info.isDirectory() && !info.isFile())
      throw new Error(`Cannot import special filesystem entry: ${current}`)
    if (ancestors.has(canonical)) throw new Error(`Directory link cycle: ${current}`)
    if (info.isFile() && info.size > MAX_DESKTOP_IMPORT_FILE_BYTES)
      throw new Error(
        'Desktop imports support files up to 64 MB. Use the file uploader for larger files.'
      )
    entries.push({
      relativePath: relative(path, current).split(sep).join('/'),
      kind: info.isDirectory() ? 'directory' : 'file',
      size: info.size,
      revision: revision(info),
    })
    if (info.isDirectory()) {
      const next = new Set([...ancestors, canonical])
      const children = await readApprovedDirectory(canonical, access)
      if (children.truncated)
        throw new Error(
          'The directory exceeds 1,000 entries. Import smaller subdirectories separately.'
        )
      for (const entry of children.entries) await walk(join(current, entry.name), next)
    }
  }
  await walk(path, new Set())
  return {
    kind: 'manifest',
    name: basename(path),
    targetWorkspaceId: args.targetWorkspaceId,
    ...(typeof args.folderId === 'string' ? { folderId: args.folderId } : {}),
    entries,
  }
}

/** Requires both a pending server call and a main-process grant before returning local data. */
export async function executeLocalFileRequest(
  request: unknown,
  authorization: LocalFileAuthorization,
  access: LocalFileAccess
): Promise<DesktopLocalFileResponse> {
  try {
    if (!isRecordLike(request)) throw new Error('Invalid local file request.')
    const path = await access.resolve(access.path)
    if (request.operation === 'read' && authorization.toolName === 'read_local_file') {
      const data = await inspect(path, authorization.args, access)
      await access.resolve(path)
      return { ok: true, data }
    }
    if (authorization.toolName !== 'import_local_files')
      throw new Error('The operation does not match the pending tool call.')
    if (request.operation === 'manifest') {
      const data = await manifest(path, authorization.args, access)
      await access.resolve(path)
      return { ok: true, data }
    }
    if (
      request.operation !== 'chunk' ||
      typeof request.relativePath !== 'string' ||
      typeof request.revision !== 'string'
    )
      throw new Error('Invalid file chunk request.')
    const child = resolve(path, request.relativePath)
    assertImportPath(path, child)
    const root = await access.resolve(path)
    const canonical = await access.resolve(child)
    assertImportPath(root, canonical)
    const offset = boundedInteger(request.offset, 0, Number.MAX_SAFE_INTEGER)
    const file = await openApprovedPath(canonical, access)
    try {
      const info = await file.stat()
      if (!info.isFile() || revision(info) !== request.revision)
        throw new Error(
          'The source file changed during import. Inspect the partial result before retrying.'
        )
      if (offset > info.size) throw new Error('The requested offset is outside the file.')
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, info.size - offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      if (revision(await file.stat()) !== request.revision)
        throw new Error('The source file changed during import.')
      await access.resolve(child)
      return {
        ok: true,
        data: {
          kind: 'chunk',
          bytes: new Uint8Array(buffer.subarray(0, bytesRead)),
          eof: offset + bytesRead >= info.size,
        },
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) }
  }
}
