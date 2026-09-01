import { lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import type { Session } from 'electron'
import { app } from 'electron'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopDownloads')

const MAX_FILENAME_LENGTH = 200
const MAX_DOWNLOAD_PATH_ATTEMPTS = 16
const DOWNLOAD_PATH_SUFFIX_LENGTH = 8

const MIME_EXTENSIONS: Record<string, string> = {
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
}

/**
 * Strips path separators and control characters from a server- or
 * blob-suggested filename so it can never escape the chosen directory.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned.slice(0, MAX_FILENAME_LENGTH)
}

/**
 * Resolves the save-dialog default name. Blob downloads often arrive with no
 * usable filename — fall back to a timestamped name with a mime-derived
 * extension.
 */
export function suggestedFilename(
  rawName: string,
  mimeType: string,
  now: Date = new Date()
): string {
  const sanitized = sanitizeFilename(rawName)
  if (sanitized && sanitized !== 'download') {
    return sanitized
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const extension = MIME_EXTENSIONS[mimeType] ?? ''
  return `download-${stamp}${extension}`
}

export interface UniqueDownloadPathOptions {
  /** Asynchronous filesystem seam used by tests and non-standard storage backends. */
  pathExists?: (path: string) => boolean | Promise<boolean>
  /** Atomically reserves a candidate against other allocations in this process. */
  reservePath?: (path: string) => boolean
  /** Stops an allocation whose owning download was torn down while I/O was pending. */
  isActive?: () => boolean
  /** Deterministic test seam for collision-resistant copy suffixes. */
  suffixForAttempt?: (attempt: number) => string
  maxAttempts?: number
}

async function downloadPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function suffixedFilename(filename: string, suffix: string): string {
  const extension = extname(filename)
  const stem = basename(filename, extension)
  const marker = ` (${suffix})`
  const maxStemLength = Math.max(1, MAX_FILENAME_LENGTH - extension.length - marker.length)
  return `${stem.slice(0, maxStemLength)}${marker}${extension}`
}

/**
 * Asynchronously reserves a non-conflicting destination without blocking the
 * Electron main thread. The original filename remains the first choice; a
 * bounded number of collision-resistant alternatives avoids an unbounded scan
 * through attacker-controlled pre-existing copy names.
 */
export async function uniqueDownloadPath(
  directory: string,
  rawFilename: string,
  options: UniqueDownloadPathOptions = {}
): Promise<string | null> {
  const filename = sanitizeFilename(rawFilename) || 'download'
  const pathExists = options.pathExists ?? downloadPathExists
  const reservePath = options.reservePath ?? (() => true)
  const isActive = options.isActive ?? (() => true)
  const suffixForAttempt =
    options.suffixForAttempt ?? (() => generateShortId(DOWNLOAD_PATH_SUFFIX_LENGTH))
  const requestedAttempts = options.maxAttempts ?? MAX_DOWNLOAD_PATH_ATTEMPTS
  const maxAttempts = Math.max(
    1,
    Math.min(
      MAX_DOWNLOAD_PATH_ATTEMPTS,
      Number.isFinite(requestedAttempts)
        ? Math.trunc(requestedAttempts)
        : MAX_DOWNLOAD_PATH_ATTEMPTS
    )
  )

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isActive()) return null
    const suffix =
      attempt === 0
        ? ''
        : sanitizeFilename(suffixForAttempt(attempt)).slice(0, 32) ||
          generateShortId(DOWNLOAD_PATH_SUFFIX_LENGTH)
    const candidateFilename = attempt === 0 ? filename : suffixedFilename(filename, suffix)
    const candidate = join(directory, candidateFilename)
    if (await pathExists(candidate)) continue
    if (!isActive()) return null
    if (reservePath(candidate)) return candidate
  }
  return null
}

/**
 * Wires will-download so exports, blob URLs, and presigned-URL downloads all
 * get a native save dialog with a sensible default name, and completed
 * downloads bounce the Dock Downloads stack.
 */
export function attachDownloadHandling(session: Session, events: EventRecorder): void {
  session.on('will-download', (_event, item) => {
    const filename = suggestedFilename(item.getFilename(), item.getMimeType())
    item.setSaveDialogOptions({
      defaultPath: join(app.getPath('downloads'), filename),
    })
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        logger.info('Download completed', { filename })
        if (process.platform === 'darwin') {
          app.dock?.downloadFinished(item.getSavePath())
        }
      } else if (state === 'interrupted') {
        logger.warn('Download interrupted', { filename })
        events.record('load_failure', { kind: 'download-interrupted' })
      }
    })
  })
}
