import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import type { FirefliesUploadAudioInput } from '@/lib/internal/fireflies/schema'
import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('FirefliesUploadAudio')
const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql'
const FIREFLIES_AUDIO_PRESIGN_EXPIRY_SECONDS = 60 * 60
const MAX_FIREFLIES_RESPONSE_BYTES = 10 * 1024 * 1024
const UPLOAD_AUDIO_MUTATION = `
  mutation UploadAudio($input: AudioUploadInput) {
    uploadAudio(input: $input) {
      success
      title
      message
    }
  }
`

export interface FirefliesOperationContext {
  headers: Headers
  userId: string
  requestId: string
  signal?: AbortSignal
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ errors: [{ message }] }, { status })
}

function normalizeStoredAudioFile(
  file: NonNullable<FirefliesUploadAudioInput['audioFile']>
): RawFileInput {
  return {
    ...file,
    name: file.name || 'audio',
    size: file.size ?? 0,
  } as RawFileInput
}

async function resolveAudioUrl(
  body: FirefliesUploadAudioInput,
  context: FirefliesOperationContext
): Promise<{ fileUrl?: string; error?: { status: number; message: string } }> {
  const file = body.audioFile
  const shared = {
    userId: context.userId,
    requestId: context.requestId,
    logger,
    presignExpirySeconds: FIREFLIES_AUDIO_PRESIGN_EXPIRY_SECONDS,
    modelEgress: true,
  } as const

  if (file?.key) {
    return resolveFileInputToUrl({
      ...shared,
      file: normalizeStoredAudioFile(file),
    })
  }

  return resolveFileInputToUrl({
    ...shared,
    filePath: file?.url || file?.path || body.audioUrl,
  })
}

export async function executeFirefliesUploadAudio(
  body: FirefliesUploadAudioInput,
  context: FirefliesOperationContext
): Promise<Response> {
  try {
    context.signal?.throwIfAborted()
    const modelInputProvenance = validateOpaqueModelInputProvenance({
      headers: context.headers,
      payload: body,
      isInternalRequest: true,
    })
    if (!modelInputProvenance.success) {
      return errorResponse(modelInputProvenance.error, modelInputProvenance.status)
    }

    const resolution = await resolveAudioUrl(body, context)
    context.signal?.throwIfAborted()
    if (resolution.error) return errorResponse(resolution.error.message, resolution.error.status)
    if (!resolution.fileUrl?.startsWith('https://')) {
      return errorResponse('Audio URL must be a valid HTTPS URL', 400)
    }

    const input: Record<string, unknown> = { url: resolution.fileUrl }
    if (body.title) input.title = body.title
    if (body.webhook) input.webhook = body.webhook
    if (body.language) input.custom_language = body.language
    if (body.clientReferenceId) input.client_reference_id = body.clientReferenceId
    if (body.attendees !== undefined) input.attendees = body.attendees

    const response = await fetch(FIREFLIES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify({ query: UPLOAD_AUDIO_MUTATION, variables: { input } }),
      signal: context.signal,
    })
    const data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_FIREFLIES_RESPONSE_BYTES,
      label: 'Fireflies response',
      signal: context.signal,
    })

    logger.info(`[${context.requestId}] Fireflies upload request completed`, {
      status: response.status,
    })
    return Response.json(data, { status: response.status })
  } catch (error) {
    if (context.signal?.aborted) throw error
    logger.error(`[${context.requestId}] Fireflies upload failed`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return errorResponse('Failed to upload audio', 500)
  }
}
