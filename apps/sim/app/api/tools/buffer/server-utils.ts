import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
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
 * Returns true when the media should be attached as a video asset, based on
 * the file's MIME type or, failing that, the URL/file extension.
 */
function isVideoMedia(mimeType: string | undefined, pathOrName: string): boolean {
  if (mimeType?.startsWith('video/')) return true
  if (mimeType?.startsWith('image/')) return false
  const lowered = pathOrName.toLowerCase().split('?')[0]
  return VIDEO_EXTENSIONS.some((extension) => lowered.endsWith(extension))
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
  const { media, mediaAltText, userId, requestId, logger } = options

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
  if (isVideoMedia(mimeType, pathOrName)) {
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

  if (result?.__typename !== 'PostActionSuccess') {
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
  const { apiKey, postId, channelId, media, mediaAltText, userId, requestId, logger } = options

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
