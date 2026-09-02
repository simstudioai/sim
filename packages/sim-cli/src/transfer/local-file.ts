import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { type EmbedContext, embedStore } from '../embed-context'
import { SimApiError } from '../http/client'

/** The pre-read map is keyed by the path as written, without the `@`. */
export function embeddedFileKey(path: string): string {
  return path.startsWith('@') ? path.slice(1) : path
}

/**
 * An embedded run executes in-process on the hosting server, so a positional path must
 * never reach the server's filesystem: the host pre-reads `@path` tokens from the
 * caller's own machine into the embed context, and anything else is refused.
 */
export function embeddedFileContent(embedded: EmbedContext, path: string): string {
  const key = embeddedFileKey(path)
  const content = embedded.fileArguments?.[key]
  if (content !== undefined) return content
  throw new SimApiError(
    `No file "${key}" on your machine — write it first (run_code or | to-sandbox), then pass it as @${key}`,
    0
  )
}

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  html: 'text/html',
  htm: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  jsonl: 'application/jsonl',
  md: 'text/markdown',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

export function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

export interface LocalFile {
  name: string
  size: number
}

/** Validates the size and name shared by every local-file transfer. */
export async function localFile(path: string, override?: string): Promise<LocalFile> {
  const embedded = embedStore.getStore()
  if (embedded) {
    const content = embeddedFileContent(embedded, path)
    const size = Buffer.byteLength(content)
    if (size === 0) throw new SimApiError(`${path} is empty`, 0)
    return { name: override ?? basename(embeddedFileKey(path)), size }
  }
  let size: number
  try {
    const stats = await stat(path)
    if (!stats.isFile()) throw new SimApiError(`${path} is not a regular file`, 0)
    // `stat` succeeds on a file the process may not open, so an unreadable file
    // would otherwise surface much later as a raw `fetch failed` from the blob
    // the upload streams, rather than as one line here alongside the other
    // bad-input checks.
    await access(path, constants.R_OK)
    size = stats.size
  } catch (error) {
    if (error instanceof SimApiError) throw error
    throw new SimApiError(`Cannot read ${path}: ${(error as Error).message}`, 0)
  }
  if (size === 0) throw new SimApiError(`${path} is empty`, 0)
  return { name: override ?? basename(path), size }
}
