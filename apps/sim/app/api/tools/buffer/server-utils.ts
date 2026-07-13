import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'
import {
  BUFFER_API_URL,
  BUFFER_POST_SELECTION,
  bufferHeaders,
  mapBufferPost,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const MEDIA_PROBE_TIMEOUT_MS = 5000

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          ${BUFFER_POST_SELECTION}
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          ${BUFFER_POST_SELECTION}
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`

interface ResolveMediaAssetOptions {
  media: RawFileInput | string
  mediaType?: 'auto' | 'image' | 'video' | null
  mediaAltText?: string | null
  userId: string
  requestId: string
  logger: Logger
}

interface ResolvedMediaAsset {
  asset?: Record<string, unknown>
  errorResponse?: NextResponse
}

/**
 * Classifies media by extension: 'video', 'image', or null when the
 * path/URL has no recognizable media extension.
 */
function mediaKindFromExtension(pathOrName: string): 'image' | 'video' | null {
  const lowered = pathOrName.toLowerCase().split(/[?#]/)[0]
  if (VIDEO_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return 'video'
  if (IMAGE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return 'image'
  return null
}

/**
 * Determines whether media should be attached as a video or image asset.
 * Prefers the file's MIME type, then the path/URL extension, and for
 * extensionless URLs falls back to a DNS-pinned HEAD probe of the resolved
 * URL's Content-Type. Returns null when nothing is conclusive so the caller
 * can ask for an explicit media type instead of guessing.
 */
async function resolveMediaKind(
  mimeType: string | undefined,
  pathOrName: string,
  fileUrl: string,
  requestId: string,
  logger: Logger
): Promise<'image' | 'video' | null> {
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('image/')) return 'image'

  const extensionKind = mediaKindFromExtension(pathOrName)
  if (extensionKind) return extensionKind

  try {
    const validation = await validateUrlWithDNS(fileUrl, 'media')
    if (validation.isValid && validation.resolvedIP) {
      const probe = await secureFetchWithPinnedIP(fileUrl, validation.resolvedIP, {
        method: 'HEAD',
        timeout: MEDIA_PROBE_TIMEOUT_MS,
      })
      const contentType = probe.headers.get('content-type') || ''
      if (contentType.startsWith('video/')) return 'video'
      if (contentType.startsWith('image/')) return 'image'
    }
  } catch (error) {
    logger.warn(`[${requestId}] Media content-type probe was inconclusive`, {
      error: getErrorMessage(error, 'probe failed'),
    })
  }
  return null
}

/**
 * Resolves a media input (uploaded file, file reference, or external URL) to a
 * Buffer AssetInput. Buffer downloads assets from publicly accessible URLs, so
 * stored files are verified for access and resolved to short-lived presigned
 * URLs.
 */
export async function resolveMediaAsset(
  options: ResolveMediaAssetOptions
): Promise<ResolvedMediaAsset> {
  const { media, mediaType, mediaAltText, userId, requestId, logger } = options

  const isFileInput = typeof media === 'object'
  const resolution = await resolveFileInputToUrl({
    file: isFileInput ? media : undefined,
    filePath: isFileInput ? undefined : media,
    userId,
    requestId,
    logger,
  })
  if (resolution.error || !resolution.fileUrl) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: resolution.error?.message || 'Failed to resolve media file' },
        { status: resolution.error?.status || 400 }
      ),
    }
  }

  const mimeType = isFileInput ? media.type : undefined
  const pathOrName = isFileInput ? media.name || '' : media
  const kind =
    mediaType === 'image' || mediaType === 'video'
      ? mediaType
      : await resolveMediaKind(mimeType, pathOrName, resolution.fileUrl, requestId, logger)
  if (!kind) {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error:
            'Could not determine whether the media is an image or a video. Set mediaType to "image" or "video".',
        },
        { status: 400 }
      ),
    }
  }
  if (kind === 'video') {
    return { asset: { video: { url: resolution.fileUrl } } }
  }

  const image: Record<string, unknown> = { url: resolution.fileUrl }
  if (mediaAltText?.trim()) {
    image.metadata = { altText: mediaAltText.trim() }
  }
  return { asset: { image } }
}

interface ExecutePostMutationOptions {
  apiKey: string
  mutation: typeof CREATE_POST_MUTATION | typeof EDIT_POST_MUTATION
  input: Record<string, unknown>
  requestId: string
  logger: Logger
}

/**
 * Executes a createPost/editPost mutation against the Buffer GraphQL API and
 * maps the PostActionPayload union onto the route's response envelope.
 */
async function executePostMutation(options: ExecutePostMutationOptions): Promise<NextResponse> {
  const { apiKey, mutation, input, requestId, logger } = options

  let result: Record<string, any>
  try {
    const response = await fetch(BUFFER_API_URL, {
      method: 'POST',
      headers: bufferHeaders(apiKey),
      body: JSON.stringify({ query: mutation, variables: { input } }),
    })
    const data = await parseBufferGraphQLResponse(response)
    result = data.createPost ?? data.editPost
  } catch (error) {
    const message = getErrorMessage(error, 'Buffer API request failed')
    logger.error(`[${requestId}] Buffer post mutation failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }

  if (result?.__typename !== 'PostActionSuccess' || !result.post) {
    const message = result?.message || 'Buffer rejected the post'
    logger.warn(`[${requestId}] Buffer rejected post mutation`, {
      typename: result?.__typename,
      error: message,
    })
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    output: { post: mapBufferPost(result.post) },
  })
}

interface ForwardPostMutationOptions {
  apiKey: string
  postId?: string
  channelId?: string
  text?: string | null
  mode: string
  schedulingType: string
  dueAt?: string | null
  saveToDraft?: boolean | null
  media?: RawFileInput | string | null
  mediaType?: 'auto' | 'image' | 'video' | null
  mediaAltText?: string | null
  userId: string
  requestId: string
  logger: Logger
}

/**
 * Builds the CreatePostInput/EditPostInput from a validated route body
 * (resolving media to a fetchable URL) and forwards the mutation to Buffer.
 * Passing `postId` selects the editPost mutation; otherwise createPost runs.
 */
export async function forwardPostMutation(
  options: ForwardPostMutationOptions
): Promise<NextResponse> {
  const { apiKey, postId, channelId, media, mediaType, mediaAltText, userId, requestId, logger } =
    options

  const input: Record<string, unknown> = {
    mode: options.mode,
    schedulingType: options.schedulingType,
  }
  if (postId) {
    input.id = postId
  } else {
    input.channelId = channelId
    input.assets = []
  }
  if (options.text != null && options.text !== '') input.text = options.text
  if (options.dueAt) input.dueAt = options.dueAt
  if (options.saveToDraft != null) input.saveToDraft = options.saveToDraft

  if (media) {
    const { asset, errorResponse } = await resolveMediaAsset({
      media,
      mediaType,
      mediaAltText,
      userId,
      requestId,
      logger,
    })
    if (errorResponse) return errorResponse
    input.assets = [asset]
  }

  return executePostMutation({
    apiKey,
    mutation: postId ? EDIT_POST_MUTATION : CREATE_POST_MUTATION,
    input,
    requestId,
    logger,
  })
}
