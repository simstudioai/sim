import type { Buffer } from 'buffer'
import path from 'path'
import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('FetchExternalUrl')

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

/**
 * Thrown when the URL fails SSRF/DNS validation. Callers should map this to a
 * user-facing 4xx-style response rather than a generic fetch failure.
 */
export class ExternalUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalUrlValidationError'
  }
}

export interface FetchExternalUrlOptions {
  url: string
  userId: string
  /** When provided alongside `saveToWorkspace: true`, the downloaded bytes are persisted as a workspace file. */
  workspaceId?: string
  /** Defaults to true when a `workspaceId` is provided. Set false when the URL already points at our own storage. */
  saveToWorkspace?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
  maxDownloadBytes?: number
  timeoutMs?: number
}

export interface FetchExternalUrlResult {
  /**
   * Filename derived from the URL path. NOT a content identity — distinct URLs
   * frequently share the same path tail (e.g. every Slack clipboard paste is
   * `image.png`). Never use this as a cache key.
   */
  filename: string
  buffer: Buffer
  /** Content-Type from the response, or inferred from the filename extension. */
  mimeType: string
  /**
   * Saved workspace file record. Undefined when the workspace save was skipped
   * (no workspaceId, `saveToWorkspace: false`, missing write permission, or a
   * save error — the last is logged, not thrown, so the parse path stays alive).
   */
  savedWorkspaceFile?: UserFile
}

/**
 * Fetch an external URL into memory and (optionally) save it as a fresh workspace file.
 *
 * URL fetches are NEVER deduplicated by filename. Two URLs whose paths end in
 * `image.png` are two different fetches that produce two different workspace
 * files; `uploadWorkspaceFile` allocates a unique on-disk name (`image.png`,
 * `image (1).png`, ...) on the save side. Keying a cache by path tail would
 * silently return stale bytes — that was the original bug this helper exists
 * to make unrepresentable.
 */
export async function fetchExternalUrlToWorkspace(
  options: FetchExternalUrlOptions
): Promise<FetchExternalUrlResult> {
  const {
    url,
    userId,
    workspaceId,
    saveToWorkspace = Boolean(workspaceId),
    headers,
    signal,
    maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const urlValidation = await validateUrlWithDNS(url, 'fileUrl')
  if (!urlValidation.isValid || !urlValidation.resolvedIP) {
    throw new ExternalUrlValidationError(urlValidation.error || 'Invalid external URL')
  }

  const filename = new URL(url).pathname.split('/').pop() || 'download'
  const extension = path.extname(filename).toLowerCase().substring(1)

  const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP, {
    timeout: timeoutMs,
    maxResponseBytes: maxDownloadBytes,
    signal,
    ...(headers && Object.keys(headers).length > 0 && { headers }),
  })

  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'external url error body',
      signal,
    }).catch(() => '')
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: maxDownloadBytes,
    label: 'external url download',
    signal,
  })

  const mimeType = response.headers.get('content-type') || getMimeTypeFromExtension(extension)

  let savedWorkspaceFile: UserFile | undefined
  if (workspaceId && saveToWorkspace) {
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission === 'admin' || permission === 'write') {
      try {
        savedWorkspaceFile = await uploadWorkspaceFile(
          workspaceId,
          userId,
          buffer,
          filename,
          mimeType
        )
      } catch (saveError) {
        logger.warn('Failed to save fetched URL to workspace storage', {
          workspaceId,
          filename,
          saveError,
        })
      }
    } else if (permission === null) {
      logger.warn('Skipping workspace save: user is not a workspace member', {
        userId,
        workspaceId,
      })
    } else {
      logger.warn('Skipping workspace save: user lacks write permission', {
        userId,
        workspaceId,
        permission,
      })
    }
  }

  return { filename, buffer, mimeType, savedWorkspaceFile }
}
