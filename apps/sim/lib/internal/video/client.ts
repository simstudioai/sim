import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { buildDirectVideoRequest } from '@/lib/internal/video/direct-request'
import {
  buildFalVideoRequest,
  getFalAIValidationError,
  isCustomFalVideoModel,
} from '@/lib/internal/video/fal-request'
import { getFalVideoModel } from '@/lib/media/fal-video-catalog'
import { cancelFalRequest, downloadFalMedia } from '@/lib/media/falai'
import { fetchFalAIResult } from '@/lib/media/falai-result'
import {
  HIGGSFIELD_FAILED_STATUSES,
  higgsfieldAuthHeaders,
  higgsfieldFailureMessage,
  higgsfieldStatusUrl,
} from '@/lib/media/higgsfield'
import type { FalAICostMetadata } from '@/lib/tools/falai-pricing'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file.server'
import type { UserFile } from '@/executor/types'

const logger = createLogger('VideoProviderClient')
const MAX_VIDEO_OUTPUT_BYTES = 250 * 1024 * 1024
const MAX_VIDEO_JSON_BYTES = 2 * 1024 * 1024
const POLL_INTERVAL_MS = 5000

export type VideoProvider = 'runway' | 'veo' | 'luma' | 'minimax' | 'falai' | 'higgsfield'

export interface VideoGenerationInput {
  provider: VideoProvider
  apiKey: string
  model?: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  visualReference?: UserFile
  cameraControl?: unknown
  endpoint?: string
  promptOptimizer?: boolean
  generateAudio?: boolean
  useHostedCostTracking?: boolean
}

export interface VideoGenerationResult {
  buffer: Buffer
  width?: number
  height?: number
  jobId?: string
  duration?: number
  falaiCost?: FalAICostMetadata
}

export interface VideoGenerationContext {
  onFalCost?: (receipt: FalAICostMetadata) => void
  requestId: string
  signal?: AbortSignal
}

async function readVideoJson<T = Record<string, unknown>>(
  response: Response,
  label: string
): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: MAX_VIDEO_JSON_BYTES,
    label,
  })
}

async function readVideoErrorText(response: Response, label: string): Promise<string> {
  return readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label,
  }).catch(() => '')
}

async function waitForProvider(context: VideoGenerationContext): Promise<void> {
  await interruptibleSleep(POLL_INTERVAL_MS, context.signal)
  context.signal?.throwIfAborted()
}

export function getVideoInputValidationError(input: VideoGenerationInput): string | undefined {
  if (input.visualReference && !input.visualReference.type.toLowerCase().startsWith('image/'))
    return `Reference image must be an image file, not ${input.visualReference.type || 'an unknown type'}`
  if (input.provider === 'falai') {
    if (input.prompt.length < 3 || input.prompt.length > 2000)
      return 'Prompt must be between 3 and 2000 characters'
    return getFalAIValidationError(input)
  }
  try {
    buildDirectVideoRequest(input)
  } catch (error) {
    return getErrorMessage(error)
  }

  return undefined
}

export async function generateVideo(
  input: VideoGenerationInput,
  context: VideoGenerationContext
): Promise<VideoGenerationResult> {
  context.signal?.throwIfAborted()
  logger.info(`Generating video with ${input.provider}`, {
    requestId: context.requestId,
    model: input.model || 'default',
  })
  return input.provider === 'falai'
    ? generateWithFalAI(input, context)
    : generateWithDirectProvider(input, context)
}

/** Keeps the encoded image under 5 MB, the largest data URI Runway accepts. */
const MAX_REFERENCE_IMAGE_BYTES = Math.floor(((5 * 1024 * 1024 - 512) * 3) / 4)

async function readReferenceImageDataUri(
  file: UserFile,
  { requestId, signal }: VideoGenerationContext,
  label: string
): Promise<string> {
  assertKnownSizeWithinLimit(file.size, MAX_REFERENCE_IMAGE_BYTES, label)
  const buffer = await downloadFileFromStorage(file, requestId, logger, {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    signal,
  })
  assertKnownSizeWithinLimit(buffer.length, MAX_REFERENCE_IMAGE_BYTES, label)
  return `data:${file.type};base64,${buffer.toString('base64')}`
}

async function generateWithDirectProvider(
  input: VideoGenerationInput,
  context: VideoGenerationContext
): Promise<VideoGenerationResult> {
  const prepared = buildDirectVideoRequest(input)
  const { protocol } = prepared.model
  const { signal } = context
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (protocol === 'gemini') {
    headers['x-goog-api-key'] = input.apiKey
    headers['Api-Revision'] = '2026-05-20'
  } else if (protocol === 'higgsfield') Object.assign(headers, higgsfieldAuthHeaders(input.apiKey))
  else headers.Authorization = `Bearer ${input.apiKey}`
  if (protocol === 'runway') headers['X-Runway-Version'] = '2024-11-06'

  if (input.visualReference) {
    prepared.body.promptImage = await readReferenceImageDataUri(
      input.visualReference,
      context,
      'Runway reference image'
    )
  }
  signal?.throwIfAborted()
  const readProviderResponse = async (response: Response): Promise<Record<string, unknown>> => {
    if (!response.ok) {
      const message = await readVideoErrorText(response, 'Video provider error response')
      throw new Error(`${input.provider} API error: ${response.status} - ${message}`)
    }
    const value = await readVideoJson<unknown>(response, 'Video provider response')
    if (!isRecordLike(value)) throw new Error(`Invalid ${input.provider} response`)
    const base = isRecordLike(value.base_resp) ? value.base_resp : undefined
    if (base?.status_code !== undefined && base.status_code !== 0)
      throw new Error(
        `${input.provider} error: ${getStringProperty(base, 'status_msg') || 'Request failed'}`
      )
    return value
  }
  let data = await readProviderResponse(
    await fetch(prepared.url, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(prepared.body),
      signal,
    })
  )
  const jobId =
    getStringProperty(data, 'id') ||
    getStringProperty(data, 'task_id') ||
    getStringProperty(data, 'request_id')
  if (!jobId) throw new Error(`${input.provider} response missing job ID`)
  const encodedId = encodeURIComponent(jobId)
  const pollUrl =
    protocol === 'runway'
      ? `https://api.dev.runwayml.com/v1/tasks/${encodedId}`
      : protocol === 'minimax-v1'
        ? `https://api.minimax.io/v1/query/video_generation?task_id=${encodedId}`
        : protocol === 'luma-legacy'
          ? `https://api.lumalabs.ai/dream-machine/v1/generations/${encodedId}`
          : protocol === 'minimax-v2'
            ? `https://api.minimax.io/v2/query/video_generation/${encodedId}`
            : protocol === 'higgsfield'
              ? higgsfieldStatusUrl(jobId)
              : `${prepared.url}/${encodedId}`
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const task = protocol === 'minimax-v2' && isRecordLike(data.task) ? data.task : data
    const status = getStringProperty(task, 'status') || getStringProperty(task, 'state')
    if (['SUCCEEDED', 'completed', 'succeeded', 'Success', 'success'].includes(status || '')) {
      signal?.throwIfAborted()
      let videoUrl: string | undefined
      let buffer: Buffer | undefined
      if (protocol === 'runway') {
        videoUrl = Array.isArray(task.output)
          ? task.output.find((item): item is string => typeof item === 'string')
          : undefined
      } else if (protocol === 'luma') {
        const output = Array.isArray(task.output)
          ? task.output.find((item) => isRecordLike(item) && typeof item.url === 'string')
          : undefined
        videoUrl = isRecordLike(output) ? getStringProperty(output, 'url') : undefined
      } else if (protocol === 'luma-legacy') {
        videoUrl = isRecordLike(task.assets) ? getStringProperty(task.assets, 'video') : undefined
      } else if (protocol === 'minimax-v2') {
        videoUrl = isRecordLike(task.content) ? getStringProperty(task.content, 'url') : undefined
      } else if (protocol === 'higgsfield') {
        videoUrl = isRecordLike(task.video) ? getStringProperty(task.video, 'url') : undefined
      } else if (protocol === 'minimax-v1') {
        const fileId = getStringProperty(task, 'file_id')
        if (!fileId) throw new Error('MiniMax response missing file_id')
        const fileData = await readProviderResponse(
          await fetch(
            `https://api.minimax.io/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
            { headers, redirect: 'error', signal }
          )
        )
        videoUrl = isRecordLike(fileData.file)
          ? getStringProperty(fileData.file, 'download_url')
          : undefined
      } else {
        for (const step of Array.isArray(task.steps) ? task.steps : []) {
          if (!isRecordLike(step) || step.type !== 'model_output' || !Array.isArray(step.content))
            continue
          const video = step.content.find((item) => isRecordLike(item) && item.type === 'video')
          if (!isRecordLike(video)) continue
          videoUrl = getStringProperty(video, 'uri')
          const inline = getStringProperty(video, 'data')
          if (inline) {
            assertKnownSizeWithinLimit(
              Math.floor((inline.length * 3) / 4),
              MAX_VIDEO_OUTPUT_BYTES,
              'Google video'
            )
            buffer = Buffer.from(inline, 'base64')
          }
          if (videoUrl || buffer) break
        }
      }
      if (!buffer && videoUrl) {
        if (protocol === 'gemini') {
          const fileUrl = new URL(videoUrl)
          const fileId = fileUrl.pathname.match(/^\/v1beta\/files\/([a-zA-Z0-9_-]+):download$/)?.[1]
          if (
            fileUrl.origin !== 'https://generativelanguage.googleapis.com' ||
            fileUrl.username ||
            fileUrl.password ||
            fileUrl.hash ||
            !fileId
          )
            throw new Error('Invalid Google video file URI')
          const metadataUrl = `https://generativelanguage.googleapis.com/v1beta/files/${fileId}`
          for (let fileAttempt = 0; ; fileAttempt++) {
            const file = await readProviderResponse(
              await fetch(metadataUrl, { headers, redirect: 'error', signal })
            )
            const state = getStringProperty(file, 'state')
            if (state === 'ACTIVE') break
            if (state === 'FAILED') throw new Error('Google video processing failed')
            if (fileAttempt === maxAttempts) throw new Error('Google video processing timed out')
            await waitForProvider(context)
          }
          signal?.throwIfAborted()
          const validation = await validateUrlWithDNS(videoUrl, 'videoUrl', 'contentFetch', {
            signal,
          })
          if (!validation.isValid) throw new Error(validation.error)
          const response = await secureFetchWithPinnedIP(videoUrl, validation.resolvedIP, {
            profile: 'contentFetch',
            headers: { 'x-goog-api-key': input.apiKey },
            maxResponseBytes: MAX_VIDEO_OUTPUT_BYTES,
            signal,
          })
          if (!response.ok) throw new Error(`Google video download failed: ${response.status}`)
          buffer = await readResponseToBufferWithLimit(response, {
            maxBytes: MAX_VIDEO_OUTPUT_BYTES,
            label: 'Google video download',
            signal,
          })
        } else buffer = (await downloadFalMedia(videoUrl, signal)).buffer
      }
      if (!buffer) throw new Error(`No video in ${input.provider} response`)
      const pixelRatio =
        protocol === 'runway' && typeof prepared.body.ratio === 'string'
          ? prepared.body.ratio.split(':').map(Number)
          : []
      const dimensions =
        pixelRatio.length === 2 && pixelRatio.every((value) => value >= 100)
          ? { width: pixelRatio[0], height: pixelRatio[1] }
          : protocol === 'luma-legacy'
            ? getVideoDimensions(
                String(prepared.body.aspect_ratio),
                String(prepared.body.resolution)
              )
            : protocol === 'minimax-v1' && prepared.model.id.startsWith('hailuo-')
              ? prepared.body.resolution === '1080P'
                ? { width: 1920, height: 1080 }
                : { width: 1360, height: 768 }
              : {}
      const videoOptions = isRecordLike(prepared.body.video) ? prepared.body.video : undefined
      const duration =
        typeof task.duration === 'number'
          ? task.duration
          : typeof prepared.body.duration === 'number'
            ? prepared.body.duration
            : typeof prepared.body.duration === 'string'
              ? Number.parseFloat(prepared.body.duration)
              : typeof videoOptions?.duration === 'string'
                ? Number.parseFloat(videoOptions.duration)
                : undefined
      return { buffer, jobId, duration, ...dimensions }
    }
    if (
      protocol === 'higgsfield' &&
      HIGGSFIELD_FAILED_STATUSES.some((failedStatus) => failedStatus === status)
    ) {
      throw new Error(higgsfieldFailureMessage(status || '', task.error))
    }
    if (
      [
        'FAILED',
        'CANCELED',
        'CANCELLED',
        'failed',
        'cancelled',
        'canceled',
        'incomplete',
        'Fail',
        'Failed',
      ].includes(status || '')
    ) {
      throw new Error(
        `${input.provider} generation failed: ${getStringProperty(task, 'failure_reason') || getStringProperty(task, 'failure') || getStringProperty(task, 'error') || 'Request failed'}`
      )
    }
    if (protocol === 'gemini')
      throw new Error('Google synchronous video generation did not complete')
    if (attempt === maxAttempts) break
    await waitForProvider(context)
    data = await readProviderResponse(await fetch(pollUrl, { headers, redirect: 'error', signal }))
  }
  throw new Error(`${input.provider} video generation timed out`)
}

function getStringProperty(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function getNumberProperty(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

function getFalAIErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecordLike(error)) return getStringProperty(error, 'message') || JSON.stringify(error)
  return 'Unknown error'
}

function falQueueUrl(url: string): string {
  if (new URL(url).origin !== 'https://queue.fal.run') {
    throw new Error('Invalid Fal.ai queue URL')
  }
  return url
}

async function generateWithFalAI(
  input: VideoGenerationInput,
  context: VideoGenerationContext
): Promise<VideoGenerationResult> {
  const { apiKey, model, duration, aspectRatio, resolution, useHostedCostTracking } = input
  const { requestId, signal } = context
  signal?.throwIfAborted()
  logger.info(`Starting Fal.ai generation with model: ${model}`, { requestId })
  const { endpoint, imageField, body } = buildFalVideoRequest(input)
  if (input.visualReference && imageField) {
    body[imageField] = await readReferenceImageDataUri(
      input.visualReference,
      context,
      'Fal.ai start frame image'
    )
    signal?.throwIfAborted()
  }
  const createResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!createResponse.ok) {
    const error = await readVideoErrorText(createResponse, 'Fal.ai create error response')
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${error}`)
  }

  const createData = await readVideoJson<unknown>(createResponse, 'Fal.ai queue response')
  if (!isRecordLike(createData)) {
    throw new Error('Invalid Fal.ai queue response')
  }

  const requestIdFal = getStringProperty(createData, 'request_id')
  if (!requestIdFal) {
    throw new Error('Fal.ai queue response missing request_id')
  }

  const app = endpoint.split('/', 2).join('/')
  const requestUrl = `https://queue.fal.run/${app}/requests/${encodeURIComponent(requestIdFal)}`
  /** Built from the endpoint, never a provider URL, so a rejected one can still be cancelled. */
  const cancelUrl = `${requestUrl}/cancel`

  logger.info(`Fal.ai request created: ${requestIdFal}`, { requestId })

  let reachedTerminalStatus = false
  try {
    const statusUrl = falQueueUrl(
      getStringProperty(createData, 'status_url') || `${requestUrl}/status`
    )
    const responseUrl = falQueueUrl(getStringProperty(createData, 'response_url') || requestUrl)

    const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
    let attempts = 0

    while (attempts < maxAttempts) {
      await waitForProvider(context)

      const statusResponse = await fetch(statusUrl, {
        redirect: 'error',
        headers: {
          Authorization: `Key ${apiKey}`,
        },
        signal,
      })

      if (!statusResponse.ok) {
        await readVideoErrorText(statusResponse, 'Fal.ai status error response')
        throw new Error(`Fal.ai status check failed: ${statusResponse.status}`)
      }

      const statusData = await readVideoJson<unknown>(statusResponse, 'Fal.ai status response')
      if (!isRecordLike(statusData)) {
        throw new Error('Invalid Fal.ai status response')
      }

      if (getStringProperty(statusData, 'status') === 'COMPLETED') {
        reachedTerminalStatus = true
        const { data: resultData, cost: falaiCost } = await fetchFalAIResult({
          apiKey,
          endpointId: endpoint,
          requestId: requestIdFal,
          queueError: statusData.error,
          maxResponseBytes: MAX_VIDEO_JSON_BYTES,
          trackCost: useHostedCostTracking,
          onCost: context.onFalCost,
          signal,
          fetchResponse: (resultSignal) =>
            fetch(falQueueUrl(getStringProperty(statusData, 'response_url') || responseUrl), {
              redirect: 'error',
              headers: { Authorization: `Key ${apiKey}` },
              signal: resultSignal,
            }),
        })

        if (!isRecordLike(resultData)) {
          throw new Error('Invalid Fal.ai result response')
        }

        const videoOutput = isRecordLike(resultData.video) ? resultData.video : undefined
        const fallbackOutput = isRecordLike(resultData.output) ? resultData.output : undefined
        const videoUrl =
          getStringProperty(videoOutput, 'url') || getStringProperty(fallbackOutput, 'url')
        if (!videoUrl) {
          throw new Error('No video URL in response')
        }

        const { buffer } = await downloadFalMedia(videoUrl, signal)
        const catalogModel = getFalVideoModel(model)
        const legacyMetadata =
          !isCustomFalVideoModel(model) && (!catalogModel || catalogModel.legacyId === model)
        let width = getNumberProperty(videoOutput, 'width')
        let height = getNumberProperty(videoOutput, 'height')
        if (legacyMetadata && !width && aspectRatio?.includes(':')) {
          const dims = getVideoDimensions(aspectRatio, resolution || '1080p')
          width = dims.width
          height = dims.height
        }

        return {
          buffer,
          width: width ?? (legacyMetadata ? 1920 : undefined),
          height: height ?? (legacyMetadata ? 1080 : undefined),
          jobId: requestIdFal,
          duration:
            getNumberProperty(videoOutput, 'duration') ??
            getNumberProperty(resultData, 'duration') ??
            duration ??
            (legacyMetadata ? 5 : undefined),
          falaiCost,
        }
      }

      if (
        ['ERROR', 'FAILED', 'CANCELLED'].includes(getStringProperty(statusData, 'status') || '')
      ) {
        reachedTerminalStatus = true
        throw new Error(`Fal.ai generation failed: ${getFalAIErrorMessage(statusData.error)}`)
      }

      attempts++
    }

    throw new Error('Fal.ai generation timed out')
  } catch (error) {
    if (!reachedTerminalStatus) await cancelFalRequest(cancelUrl, apiKey, requestIdFal)
    throw error
  }
}

function getVideoDimensions(
  aspectRatio: string,
  resolution: string
): { width: number; height: number } {
  let height: number
  if (resolution === '4k' || resolution === '2160p') {
    height = 2160
  } else if (resolution === 'true_1080p') {
    height = 1080
  } else {
    const parsedHeight = Number.parseInt(resolution.replace('p', ''))
    height = Number.isFinite(parsedHeight) ? parsedHeight : 1080
  }

  const [ratioW, ratioH] = aspectRatio.split(':').map(Number)
  if (!Number.isFinite(ratioW) || !Number.isFinite(ratioH) || ratioH === 0) {
    return { width: Math.round((height * 16) / 9), height }
  }

  const width = Math.round((height * ratioW) / ratioH)

  return { width, height }
}
