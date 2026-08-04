import type { Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  type RawFileInput,
  resolveFileType,
} from '@/lib/uploads/utils/file-utils'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'
import {
  bearerHeaders,
  graphUrl,
  idString,
  readGraphError,
  readGraphJson,
} from '@/tools/instagram/utils'

/** Covers Meta's poll-once-per-minute for ≤5 minutes while the container processes. */
export const INSTAGRAM_MEDIA_URL_TTL_SECONDS = 600

const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const REEL_VIDEO_MAX_BYTES = 300 * 1024 * 1024
const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024

const JPEG_MIME = new Set(['image/jpeg', 'image/jpg'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime'])
const JPEG_EXT = new Set(['jpg', 'jpeg'])
const VIDEO_EXT = new Set(['mp4', 'mov'])

const CLOUD_STORAGE_REQUIRED_MESSAGE =
  'Cloud storage is required to publish Instagram media. Configure S3_BUCKET_NAME and AWS_REGION, or Azure Blob AZURE_STORAGE_* variables.'

export type InstagramMediaRole = 'image' | 'video' | 'cover' | 'story' | 'carousel'

export interface ResolvedInstagramMedia {
  url: string
  kind: 'image' | 'video'
  mimeType?: string
  size?: number
  name?: string
}

export interface ResolveInstagramMediaResult {
  media?: ResolvedInstagramMedia
  error?: { status: number; message: string }
}

export interface ResolveInstagramMediaOptions {
  input: unknown
  userId: string
  requestId: string
  logger: Logger
  role: InstagramMediaRole
  required?: boolean
  label?: string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`
  return `${bytes} bytes`
}

function extensionFromName(name?: string): string {
  return name ? getFileExtension(name) : ''
}

function inferKindFromMimeOrExt(
  mimeType: string | undefined,
  extension: string
): 'image' | 'video' | null {
  const mime = (mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || JPEG_EXT.has(extension)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.has(extension)) return 'video'
  return null
}

function validateMediaConstraints(
  kind: 'image' | 'video',
  role: InstagramMediaRole,
  mimeType: string | undefined,
  size: number | undefined,
  label: string
): string | null {
  const mime = (mimeType || '').toLowerCase()

  if (kind === 'image') {
    if (mime && !JPEG_MIME.has(mime)) {
      return `${label} must be a JPEG image (got ${mime})`
    }
    if (size != null && size > IMAGE_MAX_BYTES) {
      return `${label} exceeds Instagram's ${formatBytes(IMAGE_MAX_BYTES)} JPEG limit (got ${formatBytes(size)})`
    }
    return null
  }

  if (mime && !VIDEO_MIME.has(mime)) {
    return `${label} must be an MP4 or MOV video (got ${mime})`
  }

  const maxBytes = role === 'story' ? STORY_VIDEO_MAX_BYTES : REEL_VIDEO_MAX_BYTES
  if (size != null && size > maxBytes) {
    return `${label} exceeds Instagram's ${formatBytes(maxBytes)} video limit for ${role} (got ${formatBytes(size)})`
  }
  return null
}

function parseMediaFile(input: unknown): {
  file?: RawFileInput
  name?: string
  size?: number
  mimeType?: string
  error?: { status: number; message: string }
} {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const raw = input as RawFileInput
    if (!raw.name) {
      return { error: { status: 400, message: 'File must include a name' } }
    }
    return {
      file: raw,
      name: raw.name,
      size: typeof raw.size === 'number' ? raw.size : undefined,
      mimeType: resolveFileType({ type: raw.type || '', name: raw.name }),
    }
  }

  return { error: { status: 400, message: 'Media must be a Sim file' } }
}

function applyInstagramConstraints(
  url: string,
  role: InstagramMediaRole,
  label: string,
  meta: { name?: string; size?: number; mimeType?: string }
): ResolveInstagramMediaResult {
  const extension = extensionFromName(meta.name)
  const mimeType = meta.mimeType || getMimeTypeFromExtension(extension)

  let kind: 'image' | 'video'
  if (role === 'image' || role === 'cover') {
    kind = 'image'
  } else if (role === 'video') {
    kind = 'video'
  } else {
    const inferred = inferKindFromMimeOrExt(mimeType, extension)
    if (!inferred) {
      return {
        error: {
          status: 400,
          message: `${label} must be a JPEG image or MP4/MOV video`,
        },
      }
    }
    kind = inferred
  }

  if (
    (role === 'story' || role === 'carousel') &&
    (!mimeType || mimeType === 'application/octet-stream')
  ) {
    if (JPEG_EXT.has(extension)) kind = 'image'
    else if (VIDEO_EXT.has(extension)) kind = 'video'
  }

  const constraintError = validateMediaConstraints(
    kind,
    role,
    mimeType === 'application/octet-stream' ? undefined : mimeType,
    meta.size,
    label
  )
  if (constraintError) {
    return { error: { status: 400, message: constraintError } }
  }

  if (kind === 'image' && extension && !JPEG_EXT.has(extension) && !mimeType) {
    return {
      error: { status: 400, message: `${label} must be a JPEG (.jpg/.jpeg)` },
    }
  }
  if (kind === 'video' && extension && !VIDEO_EXT.has(extension) && !mimeType) {
    return {
      error: { status: 400, message: `${label} must be an MP4 or MOV video` },
    }
  }

  return {
    media: {
      url,
      kind,
      mimeType,
      size: meta.size,
      name: meta.name,
    },
  }
}

/**
 * Resolve a canonical Sim file into a Meta-fetchable HTTPS URL.
 * Delegates UserFile serialization and URL minting to {@link resolveFileInputToUrl}
 * (600s TTL, prefer key presign). Instagram-specific MIME/size checks stay here.
 */
export async function resolveInstagramMedia(
  options: ResolveInstagramMediaOptions
): Promise<ResolveInstagramMediaResult> {
  const { input, userId, requestId, logger, role, required = true, label = 'Media' } = options

  if (input == null || input === '') {
    if (required) {
      return { error: { status: 400, message: `${label} is required` } }
    }
    return {}
  }

  const parsed = parseMediaFile(input)
  if (parsed.error || !parsed.file) {
    return { error: parsed.error || { status: 400, message: `${label} is required` } }
  }

  const { file, name, size, mimeType } = parsed
  if (!hasCloudStorage()) {
    return { error: { status: 400, message: CLOUD_STORAGE_REQUIRED_MESSAGE } }
  }

  const resolution = await resolveFileInputToUrl({
    file,
    userId,
    requestId,
    logger,
    presignExpirySeconds: INSTAGRAM_MEDIA_URL_TTL_SECONDS,
  })

  if (resolution.error || !resolution.fileUrl) {
    return {
      error: resolution.error || { status: 400, message: `${label} is required` },
    }
  }

  return applyInstagramConstraints(resolution.fileUrl, role, label, {
    name,
    size,
    mimeType,
  })
}

/**
 * Resolve a bounded array of canonical Sim files for carousel publishing.
 */
export async function resolveInstagramCarouselMedia(
  input: unknown,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<{ items?: ResolvedInstagramMedia[]; error?: { status: number; message: string } }> {
  if (!Array.isArray(input)) {
    return { error: { status: 400, message: 'Carousel media is required' } }
  }

  const items: ResolvedInstagramMedia[] = []
  if (input.length < 2 || input.length > 10) {
    return { error: { status: 400, message: 'Carousels require between 2 and 10 items' } }
  }

  for (let i = 0; i < input.length; i++) {
    const result = await resolveInstagramMedia({
      input: input[i],
      userId,
      requestId,
      logger,
      role: 'carousel',
      label: `Carousel item ${i + 1}`,
    })
    if (result.error || !result.media) {
      return {
        error: result.error || { status: 400, message: `Failed to resolve carousel item ${i + 1}` },
      }
    }
    items.push(result.media)
  }

  return { items }
}

export async function resolveIgUserId(
  accessToken: string,
  igUserId?: string,
  signal?: AbortSignal
): Promise<string> {
  if (igUserId?.trim()) return igUserId.trim()

  const response = await fetch(graphUrl('/me', { fields: 'user_id' }), {
    headers: bearerHeaders(accessToken),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to resolve Instagram user id: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ user_id?: string | number }>(
    response,
    'Instagram user response',
    signal
  )
  const userId = idString(data.user_id)
  if (!userId) throw new Error('Instagram /me response did not include a user_id')
  return userId
}

export type ContainerStatusCode = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

async function getContainerStatus(
  accessToken: string,
  containerId: string,
  signal?: AbortSignal
): Promise<{ statusCode: ContainerStatusCode | null; status: string | null }> {
  const response = await fetch(graphUrl(`/${containerId}`, { fields: 'status_code,status' }), {
    headers: bearerHeaders(accessToken),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to get container status: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ status_code?: string; status?: string }>(
    response,
    'Instagram container status response',
    signal
  )
  return {
    statusCode: (data.status_code as ContainerStatusCode | undefined) ?? null,
    status: data.status ?? null,
  }
}

const POLL_INTERVAL_MS = 60_000
const POLL_MAX_ATTEMPTS = 6

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(POLL_INTERVAL_MS)
    return
  }
  if (signal.aborted) {
    throw toError(signal.reason ?? new Error('Instagram publishing was cancelled'))
  }

  let abortHandler: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () =>
      reject(toError(signal.reason ?? new Error('Instagram publishing was cancelled')))
    signal.addEventListener('abort', abortHandler, { once: true })
  })

  try {
    await Promise.race([sleep(POLL_INTERVAL_MS), aborted])
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

export async function waitForContainerReady(
  accessToken: string,
  containerId: string,
  signal?: AbortSignal
): Promise<{ statusCode: ContainerStatusCode; status: string | null }> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const { statusCode, status } = await getContainerStatus(accessToken, containerId, signal)
    if (statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return { statusCode, status }
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        `Instagram media container ${containerId} failed with status ${statusCode}${status ? `: ${status}` : ''}`
      )
    }
    if (attempt < POLL_MAX_ATTEMPTS - 1) await waitForNextPoll(signal)
  }

  throw new Error(`Timed out waiting for Instagram container ${containerId} to finish processing`)
}

async function postGraphForm(
  accessToken: string,
  path: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) form.set(key, String(value))
  }

  return fetch(graphUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal,
  })
}

export async function createMediaContainer(
  accessToken: string,
  igUserId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const response = await postGraphForm(accessToken, `/${igUserId}/media`, body, signal)
  if (!response.ok) {
    throw new Error(`Failed to create media container: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ id?: string | number }>(
    response,
    'Instagram create container response',
    signal
  )
  const id = idString(data.id)
  if (!id) throw new Error('Create media container response missing id')
  return id
}

export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await postGraphForm(
    accessToken,
    `/${igUserId}/media_publish`,
    { creation_id: creationId },
    signal
  )
  if (!response.ok) {
    throw new Error(`Failed to publish media: ${await readGraphError(response)}`)
  }

  const data = await readGraphJson<{ id?: string | number }>(
    response,
    'Instagram publish media response',
    signal
  )
  const id = idString(data.id)
  if (!id) throw new Error('Publish media response missing id')
  return id
}
