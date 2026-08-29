import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { BufferOperationError } from '@/lib/internal/buffer/errors'
import type { BufferCreatePostInput, BufferEditPostInput } from '@/lib/internal/buffer/input'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'
import {
  BUFFER_API_URL,
  BUFFER_POST_SELECTION,
  type BufferPostResponse,
  bufferHeaders,
  mapBufferPost,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'

const logger = createLogger('BufferOperations')
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const MEDIA_PROBE_TIMEOUT_MS = 5000
const MEDIA_PRESIGN_EXPIRY_SECONDS = 7 * 24 * 60 * 60

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { ${BUFFER_POST_SELECTION} } }
      ... on MutationError { message }
    }
  }
`

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { ${BUFFER_POST_SELECTION} } }
      ... on MutationError { message }
    }
  }
`

export interface BufferOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mediaKindFromExtension(pathOrName: string): 'image' | 'video' | null {
  const lowered = pathOrName.toLowerCase().split(/[?#]/)[0]
  if (VIDEO_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return 'video'
  if (IMAGE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) return 'image'
  return null
}

async function resolveMediaKind(args: {
  mimeType?: string
  pathOrName: string
  fileUrl: string
  context: BufferOperationContext
}): Promise<'image' | 'video' | null> {
  const { mimeType, pathOrName, fileUrl, context } = args
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('image/')) return 'image'
  const extensionKind = mediaKindFromExtension(pathOrName)
  if (extensionKind) return extensionKind

  // A `fileUrl` minted by `resolveFileInputToUrl` is a presigned URL against
  // Sim's own storage, which on a self-hosted deployment legitimately sits on a
  // private address. A caller-supplied URL passes through that helper unchanged
  // and was already judged as content there, so widening here re-permits
  // nothing it refused.
  try {
    const validation = await validateUrlWithDNS(fileUrl, 'media', 'configuredEndpoint')
    context.signal?.throwIfAborted()
    if (validation.isValid) {
      const probe = await secureFetchWithPinnedIP(fileUrl, validation.resolvedIP, {
        profile: 'configuredEndpoint',
        method: 'HEAD',
        timeout: MEDIA_PROBE_TIMEOUT_MS,
        signal: context.signal,
      })
      const contentType = probe.headers.get('content-type') || ''
      if (contentType.startsWith('video/')) return 'video'
      if (contentType.startsWith('image/')) return 'image'
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.warn(`[${context.requestId}] Media content-type probe was inconclusive`, {
      error: getErrorMessage(error, 'probe failed'),
    })
  }
  return null
}

async function resolveMediaAsset(
  input: BufferCreatePostInput | BufferEditPostInput,
  context: BufferOperationContext
): Promise<Record<string, unknown> | undefined> {
  if (!input.media) return undefined
  context.signal?.throwIfAborted()
  const media = input.media
  const isFileInput = typeof media === 'object'
  const resolution = await resolveFileInputToUrl({
    file: isFileInput ? media : undefined,
    filePath: isFileInput ? undefined : media,
    userId: context.userId,
    requestId: context.requestId,
    logger,
    presignExpirySeconds: MEDIA_PRESIGN_EXPIRY_SECONDS,
  })
  context.signal?.throwIfAborted()
  if (resolution.error || !resolution.fileUrl) {
    throw new BufferOperationError(
      resolution.error?.message || 'Failed to resolve media file',
      resolution.error?.status || 400
    )
  }

  const kind =
    input.mediaType === 'image' || input.mediaType === 'video'
      ? input.mediaType
      : await resolveMediaKind({
          mimeType: isFileInput ? media.type : undefined,
          pathOrName: isFileInput ? media.name || '' : media,
          fileUrl: resolution.fileUrl,
          context,
        })
  if (!kind) {
    throw new BufferOperationError(
      'Could not determine whether the media is an image or a video. Set mediaType to "image" or "video".',
      400
    )
  }
  if (kind === 'video') return { video: { url: resolution.fileUrl } }

  const image: Record<string, unknown> = { url: resolution.fileUrl }
  if (input.mediaAltText?.trim()) image.metadata = { altText: input.mediaAltText.trim() }
  return { image }
}

async function executePostMutation(args: {
  apiKey: string
  mutation: string
  input: Record<string, unknown>
  context: BufferOperationContext
}): Promise<BufferPostResponse> {
  const { apiKey, mutation, input, context } = args
  let result: Record<string, unknown>
  try {
    const response = await fetch(BUFFER_API_URL, {
      method: 'POST',
      headers: bufferHeaders(apiKey),
      body: JSON.stringify({ query: mutation, variables: { input } }),
      signal: context.signal,
    })
    const data = await parseBufferGraphQLResponse(response)
    const candidate = data.createPost ?? data.editPost
    result = isRecord(candidate) ? candidate : {}
  } catch (error) {
    context.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Buffer API request failed')
    logger.error(`[${context.requestId}] Buffer post mutation failed`, { error: message })
    throw new BufferOperationError(message, 502)
  }

  if (result.__typename !== 'PostActionSuccess' || !isRecord(result.post)) {
    const message = typeof result.message === 'string' ? result.message : 'Buffer rejected the post'
    throw new BufferOperationError(message, 400)
  }
  return { success: true, output: { post: mapBufferPost(result.post) } }
}

async function mutatePost(
  input: BufferCreatePostInput | BufferEditPostInput,
  context: BufferOperationContext
): Promise<BufferPostResponse> {
  context.signal?.throwIfAborted()
  const isEdit = 'postId' in input
  const mutationInput: Record<string, unknown> = {
    mode: input.mode,
    schedulingType: input.schedulingType,
  }
  if (isEdit) mutationInput.id = input.postId
  else {
    mutationInput.channelId = input.channelId
    mutationInput.assets = []
  }
  if (input.text != null && input.text !== '') mutationInput.text = input.text
  if (input.dueAt) mutationInput.dueAt = input.dueAt
  if (input.saveToDraft != null) mutationInput.saveToDraft = input.saveToDraft
  const asset = await resolveMediaAsset(input, context)
  if (asset) mutationInput.assets = [asset]
  return executePostMutation({
    apiKey: input.apiKey,
    mutation: isEdit ? EDIT_POST_MUTATION : CREATE_POST_MUTATION,
    input: mutationInput,
    context,
  })
}

export function createBufferPost(
  input: BufferCreatePostInput,
  context: BufferOperationContext
): Promise<BufferPostResponse> {
  return mutatePost(input, context)
}

export function editBufferPost(
  input: BufferEditPostInput,
  context: BufferOperationContext
): Promise<BufferPostResponse> {
  return mutatePost(input, context)
}
