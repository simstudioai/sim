import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type FirefliesUploadAudioBody,
  firefliesUploadAudioContract,
} from '@/lib/api/contracts/tools/fireflies'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('FirefliesUploadAudioAPI')
const FIREFLIES_API_URL = 'https://api.fireflies.ai/graphql'
const FIREFLIES_AUDIO_PRESIGN_EXPIRY_SECONDS = 60 * 60
const UPLOAD_AUDIO_MUTATION = `
  mutation UploadAudio($input: AudioUploadInput) {
    uploadAudio(input: $input) {
      success
      title
      message
    }
  }
`

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ errors: [{ message }] }, { status })
}

function normalizeStoredAudioFile(file: NonNullable<FirefliesUploadAudioBody['audioFile']>) {
  return {
    ...file,
    name: file.name || 'audio',
    size: file.size ?? 0,
  } satisfies RawFileInput
}

async function resolveAudioUrl(options: {
  body: FirefliesUploadAudioBody
  userId: string
  requestId: string
}): Promise<{ fileUrl?: string; error?: { status: number; message: string } }> {
  const { body, userId, requestId } = options
  const file = body.audioFile

  if (file?.key) {
    return resolveFileInputToUrl({
      file: normalizeStoredAudioFile(file),
      userId,
      requestId,
      logger,
      presignExpirySeconds: FIREFLIES_AUDIO_PRESIGN_EXPIRY_SECONDS,
      modelEgress: true,
    })
  }

  return resolveFileInputToUrl({
    filePath: file?.url || file?.path || body.audioUrl,
    userId,
    requestId,
    logger,
    presignExpirySeconds: FIREFLIES_AUDIO_PRESIGN_EXPIRY_SECONDS,
    modelEgress: true,
  })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return errorResponse('Unauthorized', 401)
    }

    const parsed = await parseRequest(
      firefliesUploadAudioContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          errorResponse(getValidationErrorMessage(error, 'Invalid request data'), 400),
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const modelInputProvenance = validateOpaqueModelInputProvenance({
      headers: request.headers,
      payload: body,
      isInternalRequest: true,
    })
    if (!modelInputProvenance.success) {
      return errorResponse(modelInputProvenance.error, modelInputProvenance.status)
    }

    const resolution = await resolveAudioUrl({ body, userId: authResult.userId, requestId })
    if (resolution.error) {
      return errorResponse(resolution.error.message, resolution.error.status)
    }
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
      body: JSON.stringify({
        query: UPLOAD_AUDIO_MUTATION,
        variables: { input },
      }),
      signal: request.signal,
    })

    logger.info(`[${requestId}] Fireflies upload request completed`, {
      status: response.status,
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Fireflies upload proxy failed`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return errorResponse('Failed to upload audio', 500)
  }
})
