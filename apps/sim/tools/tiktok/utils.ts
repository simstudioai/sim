import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import type { ZodType } from 'zod'
import { isPayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { type TikTokApiVideo, tiktokPublishInitApiDataSchema } from '@/tools/tiktok/api-schemas'
import type { TikTokApiError, TikTokDraftInitResponse, TikTokVideo } from '@/tools/tiktok/types'

export const TIKTOK_API_RESPONSE_MAX_BYTES = 1024 * 1024

/**
 * Default fields requested from TikTok's `/v2/user/info/` endpoint, covering the
 * `user.info.basic`, `user.info.profile`, and `user.info.stats` scopes.
 * `avatar_url` and `avatar_large_url` feed the file-typed `avatarFile` output.
 */
export const TIKTOK_USER_FIELD_NAMES = [
  'open_id',
  'union_id',
  'avatar_url',
  'avatar_large_url',
  'display_name',
  'bio_description',
  'profile_deep_link',
  'is_verified',
  'username',
  'follower_count',
  'following_count',
  'likes_count',
  'video_count',
] as const

export const TIKTOK_USER_FIELDS = TIKTOK_USER_FIELD_NAMES.join(',')

/**
 * Fields requested from TikTok's `/v2/video/list/` and `/v2/video/query/` endpoints.
 * All are available under the `video.list` scope.
 */
export const TIKTOK_VIDEO_FIELDS =
  'id,title,cover_image_url,embed_link,embed_html,duration,create_time,share_url,video_description,width,height,view_count,like_count,comment_count,share_count'

export function mapTikTokVideo(video: TikTokApiVideo): TikTokVideo {
  return {
    id: video.id ?? '',
    title: video.title ?? null,
    coverImageUrl: video.cover_image_url ?? null,
    embedLink: video.embed_link ?? null,
    embedHtml: video.embed_html ?? null,
    duration: video.duration ?? null,
    createTime: video.create_time ?? null,
    shareUrl: video.share_url ?? null,
    videoDescription: video.video_description ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    viewCount: video.view_count ?? null,
    likeCount: video.like_count ?? null,
    commentCount: video.comment_count ?? null,
    shareCount: video.share_count ?? null,
  }
}

interface ParsedTikTokApiResponse<TData> {
  data: TData | null
  error: TikTokApiError | null
  rawBody: string
}

interface ParsedJsonObject {
  body: Record<string, unknown> | null
  error: TikTokApiError | null
  rawBody: string
}

interface TikTokDraftInitResult {
  success: boolean
  publishId: string
  error?: string
}

interface ReadTikTokApiResponseOptions {
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function parseTikTokError(value: unknown): TikTokApiError | null {
  const error = asRecord(value)
  if (!error) return null

  const code = typeof error.code === 'string' ? error.code : null
  if (!code) return null

  return {
    code,
    ...(typeof error.message === 'string' ? { message: error.message } : {}),
    ...(typeof error.log_id === 'string' ? { logId: error.log_id } : {}),
  }
}

function httpError(response: Response, rawBody: string, message?: string): TikTokApiError {
  return {
    code: `http_${response.status}`,
    message:
      message ??
      `TikTok request failed with HTTP ${response.status}: ${truncate(rawBody.trim(), 300)}`,
  }
}

async function readJsonObject(
  response: Response,
  options: ReadTikTokApiResponseOptions = {}
): Promise<ParsedJsonObject> {
  let rawBody: string
  try {
    rawBody = await readResponseTextWithLimit(response, {
      maxBytes: TIKTOK_API_RESPONSE_MAX_BYTES,
      label: 'TikTok API response',
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    const message = isPayloadSizeLimitError(error)
      ? 'TikTok response exceeded the maximum supported size'
      : `TikTok response could not be read: ${getErrorMessage(error, 'unknown read error')}`
    return {
      body: null,
      error: {
        code: 'invalid_response',
        message,
      },
      rawBody: '',
    }
  }
  let parsed: unknown

  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return {
      body: null,
      error: response.ok
        ? { code: 'invalid_response', message: 'TikTok returned an invalid JSON response' }
        : httpError(response, rawBody),
      rawBody,
    }
  }

  const body = asRecord(parsed)
  if (!body) {
    return {
      body: null,
      error: { code: 'invalid_response', message: 'TikTok returned an unexpected response shape' },
      rawBody,
    }
  }

  return { body, error: null, rawBody }
}

function parseApiEnvelope<TData extends object>(
  response: Response,
  parsed: ParsedJsonObject,
  dataSchema: ZodType<TData>
): ParsedTikTokApiResponse<TData> {
  if (!parsed.body) {
    return { data: null, error: parsed.error, rawBody: parsed.rawBody }
  }

  const providerError = parseTikTokError(parsed.body.error)
  if (providerError?.code && providerError.code !== 'ok') {
    return { data: null, error: providerError, rawBody: parsed.rawBody }
  }

  if (!response.ok) {
    return {
      data: null,
      error: httpError(response, parsed.rawBody, providerError?.message),
      rawBody: parsed.rawBody,
    }
  }

  if (parsed.body.data === null || parsed.body.data === undefined) {
    return { data: null, error: null, rawBody: parsed.rawBody }
  }

  const dataResult = dataSchema.safeParse(parsed.body.data)
  if (!dataResult.success) {
    return {
      data: null,
      error: {
        code: 'invalid_response',
        message: 'TikTok returned an unexpected data shape',
      },
      rawBody: parsed.rawBody,
    }
  }

  return { data: dataResult.data, error: null, rawBody: parsed.rawBody }
}

/** Reads and normalizes a typed TikTok API envelope. */
export async function readTikTokApiResponse<TData extends object>(
  response: Response,
  dataSchema: ZodType<TData>,
  options: ReadTikTokApiResponseOptions = {}
): Promise<ParsedTikTokApiResponse<TData>> {
  return parseApiEnvelope(response, await readJsonObject(response, options), dataSchema)
}

/** Enforces TikTok's bounded array request limits before making a network request. */
export function assertTikTokArrayLength(values: unknown[], label: string, maximum: number): void {
  if (values.length === 0) {
    throw new Error(`${label} must contain at least one item`)
  }
  if (values.length > maximum) {
    throw new Error(`${label} supports at most ${maximum} items`)
  }
}

/**
 * The internal Sim upload route and TikTok both return publish-init envelopes.
 * Reading and normalization share one boundary.
 */
export async function readTikTokDraftInitResponse(
  response: Response
): Promise<TikTokDraftInitResult> {
  const parsed = await readJsonObject(response)
  if (!parsed.body) {
    return {
      success: false,
      publishId: '',
      error: parsed.error?.message ?? 'Failed to read publish response',
    }
  }

  if ('success' in parsed.body) {
    if (parsed.body.success !== true) {
      return {
        success: false,
        publishId: '',
        error: typeof parsed.body.error === 'string' ? parsed.body.error : 'Failed to publish',
      }
    }

    const output = asRecord(parsed.body.output)
    const publishId = typeof output?.publishId === 'string' ? output.publishId : ''
    return publishId
      ? { success: true, publishId }
      : { success: false, publishId: '', error: 'No publish ID returned' }
  }

  const result = parseApiEnvelope(response, parsed, tiktokPublishInitApiDataSchema)
  if (result.error) {
    return {
      success: false,
      publishId: '',
      error: result.error.message || result.error.code || 'Failed to initiate post',
    }
  }

  return result.data?.publish_id
    ? { success: true, publishId: result.data.publish_id }
    : { success: false, publishId: '', error: 'No publish ID returned' }
}

/** Converts a normalized draft-init result into the tool response shape. */
export function toTikTokDraftInitToolResponse(
  result: TikTokDraftInitResult
): TikTokDraftInitResponse {
  return result.success
    ? { success: true, output: { publishId: result.publishId } }
    : {
        success: false,
        output: { publishId: '' },
        error: result.error ?? 'Failed to initiate TikTok draft upload',
      }
}
