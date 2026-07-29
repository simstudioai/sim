import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { Session } from 'electron'
import { app } from 'electron'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopDownloads')

const MAX_FILENAME_LENGTH = 200

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
