/**
 * Moves browser-agent files between the Sim app and this machine.
 *
 * Uploads are staged into a private temporary directory before a page sees them: workspace files
 * stream from the app for the exact claimed tool call, and granted local files stream from a
 * pinned handle after their containment check. Both streams enforce the upload byte limit, and
 * later path replacements cannot redirect a local copy. Chromium reads a chosen file lazily, so
 * staged copies live until their browser scope is disposed. Saved downloads travel the other way,
 * bound to their own claimed tool call.
 */
import { createWriteStream, openAsBlob } from 'node:fs'
import { type FileHandle, mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { BROWSER_FILE_TRANSFER_MAX_BYTES, BROWSER_FILE_TRANSFER_PATH } from '@sim/browser-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { app } from 'electron'
import { ToolError } from '@/main/browser-agent/errors'
import type { BrowserAppSession } from '@/main/browser-agent/session'

/** Granted local folders; the caller owns and must close each returned file handle. */
export interface LocalFileSource {
  resolveGrantedFile(
    vfsPath: string,
    maxBytes: number
  ): Promise<{ handle: FileHandle; name: string; size: number }>
}

const LOCAL_PATH_PREFIX = 'user-local/'
const MAX_MB = BROWSER_FILE_TRANSFER_MAX_BYTES / 1024 / 1024

function stagingRoot(): string {
  return join(app.getPath('temp'), 'sim-browser-uploads')
}

/** One directory name per scope or call; identifiers are opaque, so encode rather than trust. */
function directoryName(value: string): string {
  return encodeURIComponent(value).replaceAll('.', '%2E')
}

/** A file name that cannot leave the staging directory. */
function stagedFileName(name: string): string {
  const base = basename(name)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : 'upload'
}

function filenameFromDisposition(header: string | null): string | null {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {}
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? null
}

async function appErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`
}

function limitBytes(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      if (total > maxBytes)
        callback(new ToolError(`The file exceeds the ${MAX_MB} MB upload limit.`))
      else callback(null, chunk)
    },
  })
}

async function stageWorkspaceFile(
  appSession: BrowserAppSession,
  toolCallId: string,
  index: number,
  directory: string,
  signal: AbortSignal | undefined
): Promise<string> {
  const response = await appSession.session.fetch(
    `${appSession.origin}${BROWSER_FILE_TRANSFER_PATH}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId, index }),
      signal,
    }
  )
  if (!response.ok || !response.body) {
    throw new ToolError(`Could not read that workspace file (${await appErrorMessage(response)}).`)
  }
  const name = stagedFileName(
    filenameFromDisposition(response.headers.get('content-disposition')) ?? 'upload'
  )
  const destination = join(directory, name)
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    limitBytes(BROWSER_FILE_TRANSFER_MAX_BYTES),
    createWriteStream(destination, { flags: 'wx' }),
    { signal }
  )
  return destination
}

/**
 * Stages every requested file for one `browser_upload_file` call and returns their local paths in
 * request order. `user-local/` paths come from granted folders; every other path is a workspace
 * reference the app resolves from the claimed call's persisted arguments.
 */
export async function stageUploadFiles({
  scopeId,
  toolCallId,
  paths,
  appSession,
  localFiles,
  signal,
}: {
  scopeId: string
  toolCallId: string
  paths: readonly string[]
  appSession: BrowserAppSession | undefined
  localFiles: LocalFileSource | undefined
  signal?: AbortSignal
}): Promise<string[]> {
  const directory = join(stagingRoot(), directoryName(scopeId), directoryName(toolCallId))
  await rm(directory, { recursive: true, force: true })
  const staged: string[] = []
  for (const [index, path] of paths.entries()) {
    const fileDirectory = join(directory, String(index))
    try {
      await mkdir(fileDirectory, { recursive: true })
      if (path.startsWith(LOCAL_PATH_PREFIX)) {
        if (!localFiles) throw new ToolError('Local folders are unavailable in this desktop app.')
        const local = await localFiles.resolveGrantedFile(path, BROWSER_FILE_TRANSFER_MAX_BYTES)
        try {
          const destination = join(fileDirectory, stagedFileName(local.name))
          await pipeline(
            local.handle.createReadStream({ autoClose: false }),
            limitBytes(BROWSER_FILE_TRANSFER_MAX_BYTES),
            createWriteStream(destination, { flags: 'wx' }),
            { signal }
          )
          staged.push(destination)
        } finally {
          await local.handle.close()
        }
      } else {
        if (!appSession) throw new ToolError('Workspace files are unavailable in this desktop app.')
        staged.push(await stageWorkspaceFile(appSession, toolCallId, index, fileDirectory, signal))
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      if (error instanceof ToolError) throw error
      throw new ToolError(`Could not prepare "${path}" for upload (${getErrorMessage(error)}).`)
    }
  }
  return staged
}

/** Deletes one scope's staged uploads, or every scope's when no id is given. */
export async function discardStagedUploads(scopeId?: string): Promise<void> {
  const target = scopeId ? join(stagingRoot(), directoryName(scopeId)) : stagingRoot()
  await rm(target, { recursive: true, force: true })
}

/** Stores a completed download as a workspace file for one claimed `browser_save_download` call. */
export async function saveDownloadToWorkspace({
  appSession,
  toolCallId,
  filePath,
  filename,
  signal,
}: {
  appSession: BrowserAppSession | undefined
  toolCallId: string
  filePath: string
  filename: string
  signal?: AbortSignal
}): Promise<{ path: string; name: string; size: number }> {
  if (!appSession) throw new ToolError('Workspace files are unavailable in this desktop app.')
  const content = await openAsBlob(filePath)
  if (content.size > BROWSER_FILE_TRANSFER_MAX_BYTES) {
    throw new ToolError(`The download exceeds the ${MAX_MB} MB workspace save limit.`)
  }
  const query = new URLSearchParams({ toolCallId, name: filename })
  const response = await appSession.session.fetch(
    `${appSession.origin}${BROWSER_FILE_TRANSFER_PATH}?${query}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: content,
      signal,
    }
  )
  if (!response.ok) {
    throw new ToolError(`Could not save the download (${await appErrorMessage(response)}).`)
  }
  const saved = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof saved?.path !== 'string' || typeof saved.name !== 'string') {
    throw new ToolError('The app did not confirm where the download was saved.')
  }
  return { path: saved.path, name: saved.name, size: Number(saved.size) || content.size }
}
