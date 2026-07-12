import type { Logger } from '@sim/logger'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  isInternalFileUrl,
  type RawFileInput,
  resolveFileType,
} from '@/lib/uploads/utils/file-utils'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

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
  'Cloud storage is required to publish uploaded Instagram media. Configure S3_BUCKET_NAME and AWS_REGION (or Azure Blob AZURE_STORAGE_* vars), or paste a public HTTPS URL instead.'

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

function extensionFromUrlOrName(value?: string): string {
  if (!value) return ''
  try {
    const pathname =
      value.startsWith('http://') || value.startsWith('https://') ? new URL(value).pathname : value
    return getFileExtension(pathname.split('?')[0] || '')
  } catch {
    return getFileExtension(value)
  }
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

function isPublicHttpUrl(value: string): boolean {
  return (value.startsWith('https://') || value.startsWith('http://')) && !isInternalFileUrl(value)
}

function needsCloudStorage(file?: RawFileInput, filePath?: string): boolean {
  if (file) return true
  if (filePath && isInternalFileUrl(filePath)) return true
  return false
}

/**
 * Split a canonical media input into the shapes {@link resolveFileInputToUrl} expects
 * (Reducto/STT pattern: file object vs filePath string).
 */
function splitMediaInput(input: unknown): {
  file?: RawFileInput
  filePath?: string
  name?: string
  size?: number
  mimeType?: string
  error?: { status: number; message: string }
} {
  if (typeof input === 'string') {
    return { filePath: input.trim() }
  }

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

  return { error: { status: 400, message: 'Media must be a file or URL string' } }
}

function applyInstagramConstraints(
  url: string,
  role: InstagramMediaRole,
  label: string,
  meta: { name?: string; size?: number; mimeType?: string }
): ResolveInstagramMediaResult {
  const mimeType =
    meta.mimeType || getMimeTypeFromExtension(extensionFromUrlOrName(meta.name || url))
  const extension = extensionFromUrlOrName(meta.name || url)

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
 * Resolve a UserFile, internal serve path, or public HTTPS URL into a Meta-fetchable HTTPS URL.
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

  const split = splitMediaInput(input)
  if (split.error) {
    return { error: split.error }
  }

  const { file, filePath, name, size, mimeType } = split
  if (filePath !== undefined && filePath === '') {
    if (required) {
      return { error: { status: 400, message: `${label} is required` } }
    }
    return {}
  }

  if (needsCloudStorage(file, filePath) && !hasCloudStorage()) {
    return { error: { status: 400, message: CLOUD_STORAGE_REQUIRED_MESSAGE } }
  }

  // Meta only curls HTTPS; reject plain HTTP before the shared helper accepts it.
  if (filePath && isPublicHttpUrl(filePath) && !filePath.startsWith('https://')) {
    return {
      error: {
        status: 400,
        message: 'Instagram media URLs must use HTTPS so Meta can download them',
      },
    }
  }

  const resolution = await resolveFileInputToUrl({
    file,
    filePath,
    userId,
    requestId,
    logger,
    ttlSeconds: INSTAGRAM_MEDIA_URL_TTL_SECONDS,
    preferKeyPresign: true,
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
 * Resolve carousel media: file array, single file, or legacy comma-separated URL string
 * (optional `video:` prefix per entry).
 */
export async function resolveInstagramCarouselMedia(
  input: unknown,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<{ items?: ResolvedInstagramMedia[]; error?: { status: number; message: string } }> {
  if (input == null || input === '') {
    return { error: { status: 400, message: 'Carousel media is required' } }
  }

  const items: ResolvedInstagramMedia[] = []

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      return { error: { status: 400, message: 'Carousel media is required' } }
    }

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return resolveInstagramCarouselMedia(parsed, userId, requestId, logger)
      } catch {
        // fall through to comma-separated URL parsing
      }
    }

    const entries = trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    if (entries.length < 2 || entries.length > 10) {
      return { error: { status: 400, message: 'Carousels require between 2 and 10 items' } }
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const isVideoPrefixed = entry.toLowerCase().startsWith('video:')
      const raw = isVideoPrefixed ? entry.slice('video:'.length).trim() : entry
      const result = await resolveInstagramMedia({
        input: raw,
        userId,
        requestId,
        logger,
        role: isVideoPrefixed ? 'video' : 'image',
        label: `Carousel item ${i + 1}`,
      })
      if (result.error || !result.media) {
        return {
          error: result.error || {
            status: 400,
            message: `Failed to resolve carousel item ${i + 1}`,
          },
        }
      }
      result.media.kind = isVideoPrefixed ? 'video' : 'image'
      items.push(result.media)
    }

    return { items }
  }

  const list = Array.isArray(input) ? input : [input]
  if (list.length < 2 || list.length > 10) {
    return { error: { status: 400, message: 'Carousels require between 2 and 10 items' } }
  }

  for (let i = 0; i < list.length; i++) {
    const result = await resolveInstagramMedia({
      input: list[i],
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
