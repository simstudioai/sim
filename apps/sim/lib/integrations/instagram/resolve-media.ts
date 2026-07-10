import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { StorageService } from '@/lib/uploads'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'
import {
  extractStorageKey,
  getFileExtension,
  getMimeTypeFromExtension,
  isInternalFileUrl,
  processSingleFileToUserFile,
  type RawFileInput,
  resolveFileType,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

/** Covers Meta's poll-once-per-minute for ≤5 minutes while the container processes. */
export const INSTAGRAM_MEDIA_URL_TTL_SECONDS = 600

const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const REEL_VIDEO_MAX_BYTES = 300 * 1024 * 1024
const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024

const JPEG_MIME = new Set(['image/jpeg', 'image/jpg'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime'])
const JPEG_EXT = new Set(['jpg', 'jpeg'])
const VIDEO_EXT = new Set(['mp4', 'mov'])

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
  const isJpeg = !mime || JPEG_MIME.has(mime)
  const isVideoMime = !mime || VIDEO_MIME.has(mime)

  if (kind === 'image') {
    if (mime && !JPEG_MIME.has(mime)) {
      return `${label} must be a JPEG image (got ${mime})`
    }
    if (size != null && size > IMAGE_MAX_BYTES) {
      return `${label} exceeds Instagram's ${formatBytes(IMAGE_MAX_BYTES)} JPEG limit (got ${formatBytes(size)})`
    }
    if (!isJpeg && mime) {
      return `${label} must be a JPEG image`
    }
    return null
  }

  // video
  if (mime && !VIDEO_MIME.has(mime)) {
    return `${label} must be an MP4 or MOV video (got ${mime})`
  }
  if (!isVideoMime && mime) {
    return `${label} must be an MP4 or MOV video`
  }

  const maxBytes = role === 'story' ? STORY_VIDEO_MAX_BYTES : REEL_VIDEO_MAX_BYTES
  if (size != null && size > maxBytes) {
    return `${label} exceeds Instagram's ${formatBytes(maxBytes)} video limit for ${role} (got ${formatBytes(size)})`
  }
  return null
}

function isPublicHttpsUrl(value: string): boolean {
  return (value.startsWith('https://') || value.startsWith('http://')) && !isInternalFileUrl(value)
}

async function resolvePublicUrl(
  url: string,
  requestId: string,
  logger: Logger
): Promise<ResolveInstagramMediaResult> {
  if (!url.startsWith('https://')) {
    return {
      error: {
        status: 400,
        message: 'Instagram media URLs must use HTTPS so Meta can download them',
      },
    }
  }

  const validation = await validateUrlWithDNS(url, 'instagramMediaUrl')
  if (!validation.isValid) {
    logger.warn(`[${requestId}] Invalid Instagram media URL`, { error: validation.error })
    return { error: { status: 400, message: validation.error || 'Invalid media URL' } }
  }

  return { media: { url, kind: 'image' } }
}

async function presignUserFile(
  userFile: UserFile,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<ResolveInstagramMediaResult> {
  if (!hasCloudStorage()) {
    return {
      error: {
        status: 400,
        message:
          'Cloud storage is required to publish uploaded Instagram media. Configure S3 or Blob storage, or paste a public HTTPS URL instead.',
      },
    }
  }

  let key = userFile.key
  if (!key && userFile.url && isInternalFileUrl(userFile.url)) {
    key = extractStorageKey(userFile.url)
  }

  if (!key) {
    if (userFile.url && isPublicHttpsUrl(userFile.url)) {
      return resolvePublicUrl(userFile.url, requestId, logger)
    }
    return {
      error: {
        status: 400,
        message: 'Uploaded file is missing a storage key and cannot be shared with Instagram',
      },
    }
  }

  const context = resolveTrustedFileContext(key, userFile.context)
  const hasAccess = await verifyFileAccess(key, userId, undefined, context, false)
  if (!hasAccess) {
    logger.warn(`[${requestId}] Unauthorized Instagram media presign attempt`, {
      userId,
      key,
      context,
    })
    return { error: { status: 404, message: 'File not found' } }
  }

  try {
    const url = await StorageService.generatePresignedDownloadUrl(
      key,
      context,
      INSTAGRAM_MEDIA_URL_TTL_SECONDS
    )
    logger.info(`[${requestId}] Generated Instagram media presigned URL`, {
      key,
      ttlSeconds: INSTAGRAM_MEDIA_URL_TTL_SECONDS,
    })
    return {
      media: {
        url,
        kind: 'image',
        mimeType: userFile.type,
        size: userFile.size,
        name: userFile.name,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to generate Instagram media URL:`, error)
    return {
      error: {
        status: 500,
        message: getErrorMessage(error, 'Failed to generate a Meta-fetchable media URL'),
      },
    }
  }
}

/**
 * Resolve a UserFile, internal serve path, or public HTTPS URL into a Meta-fetchable HTTPS URL.
 * Uploaded files are re-presigned with a 600s TTL so Meta can curl them during container processing.
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

  let resolved: ResolveInstagramMediaResult

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      if (required) {
        return { error: { status: 400, message: `${label} is required` } }
      }
      return {}
    }

    if (isInternalFileUrl(trimmed)) {
      if (!hasCloudStorage()) {
        return {
          error: {
            status: 400,
            message:
              'Cloud storage is required to publish uploaded Instagram media. Configure S3 or Blob storage, or paste a public HTTPS URL instead.',
          },
        }
      }
      const key = extractStorageKey(trimmed)
      const context = resolveTrustedFileContext(key)
      const hasAccess = await verifyFileAccess(key, userId, undefined, context, false)
      if (!hasAccess) {
        return { error: { status: 404, message: 'File not found' } }
      }
      try {
        const url = await StorageService.generatePresignedDownloadUrl(
          key,
          context,
          INSTAGRAM_MEDIA_URL_TTL_SECONDS
        )
        resolved = { media: { url, kind: 'image' } }
      } catch (error) {
        logger.error(`[${requestId}] Failed to presign internal Instagram media path:`, error)
        return {
          error: {
            status: 500,
            message: getErrorMessage(error, 'Failed to generate a Meta-fetchable media URL'),
          },
        }
      }
    } else if (isPublicHttpsUrl(trimmed) || trimmed.startsWith('http://')) {
      resolved = await resolvePublicUrl(trimmed, requestId, logger)
    } else {
      return {
        error: {
          status: 400,
          message: `${label} must be an uploaded file or a public HTTPS URL`,
        },
      }
    }
  } else if (typeof input === 'object') {
    let userFile: UserFile
    try {
      userFile = processSingleFileToUserFile(input as RawFileInput, requestId, logger)
    } catch (error) {
      return {
        error: {
          status: 400,
          message: getErrorMessage(error, `Failed to process ${label.toLowerCase()}`),
        },
      }
    }
    resolved = await presignUserFile(userFile, userId, requestId, logger)
    if (resolved.media) {
      resolved.media.mimeType = resolveFileType({
        type: userFile.type || '',
        name: userFile.name,
      })
      resolved.media.size = userFile.size
      resolved.media.name = userFile.name
    }
  } else {
    return { error: { status: 400, message: `${label} must be a file or URL string` } }
  }

  if (resolved.error || !resolved.media) {
    return resolved
  }

  const mimeType =
    resolved.media.mimeType ||
    getMimeTypeFromExtension(extensionFromUrlOrName(resolved.media.name || resolved.media.url))
  const extension = extensionFromUrlOrName(resolved.media.name || resolved.media.url)

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

  // Prefer extension hints when MIME is generic
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
    resolved.media.size,
    label
  )
  if (constraintError) {
    return { error: { status: 400, message: constraintError } }
  }

  // Soft extension check for public URLs without MIME
  if (kind === 'image' && extension && !JPEG_EXT.has(extension) && !mimeType) {
    return {
      error: {
        status: 400,
        message: `${label} must be a JPEG (.jpg/.jpeg)`,
      },
    }
  }
  if (kind === 'video' && extension && !VIDEO_EXT.has(extension) && !mimeType) {
    return {
      error: {
        status: 400,
        message: `${label} must be an MP4 or MOV video`,
      },
    }
  }

  return {
    media: {
      ...resolved.media,
      kind,
      mimeType,
    },
  }
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

    // JSON-serialized file array from advanced mode
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

    if (entries.length === 0) {
      return { error: { status: 400, message: 'Provide at least one carousel media item' } }
    }
    if (entries.length > 10) {
      return { error: { status: 400, message: 'Carousels support a maximum of 10 items' } }
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const isVideoPrefixed = entry.toLowerCase().startsWith('video:')
      const raw = isVideoPrefixed ? entry.slice('video:'.length).trim() : entry
      // Legacy comma-separated URLs: plain = image, `video:` prefix = video
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
      if (isVideoPrefixed) {
        result.media.kind = 'video'
      } else {
        result.media.kind = 'image'
      }
      items.push(result.media)
    }

    return { items }
  }

  const list = Array.isArray(input) ? input : [input]
  if (list.length === 0) {
    return { error: { status: 400, message: 'Provide at least one carousel media item' } }
  }
  if (list.length > 10) {
    return { error: { status: 400, message: 'Carousels support a maximum of 10 items' } }
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
