import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { toArray, toRecord } from '@sim/utils/object'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import {
  HIGGSFIELD_API_BASE,
  HIGGSFIELD_FAILED_STATUSES,
  higgsfieldAuthHeaders,
  higgsfieldFailureMessage,
} from '@/lib/media/higgsfield'
import type {
  HiggsfieldCharacter,
  HiggsfieldGenerationParams,
  HiggsfieldRequestOutput,
  HiggsfieldRequestResponse,
} from '@/tools/higgsfield/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('HiggsfieldTools')

const POLL_INITIAL_INTERVAL_MS = 2000
const POLL_MAX_INTERVAL_MS = 10_000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS
const TERMINAL_REQUEST_STATUSES = new Set<string>(['completed', ...HIGGSFIELD_FAILED_STATUSES])
const MODEL_ENDPOINT_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i

export const higgsfieldAuthParams = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Higgsfield API key (KEY_ID:KEY_SECRET) resolved from the selected credential',
  },
} as const satisfies ToolConfig['params']

export const higgsfieldOAuth = {
  required: true,
  provider: 'higgsfield',
  credentialKind: 'service-account',
} as const

/** Optional controls shared by every generation submission. */
export const higgsfieldGenerationControlParams = {
  waitForCompletion: {
    type: 'boolean',
    required: false,
    visibility: 'user-only',
    default: true,
    description:
      'Wait until the request finishes and return its output URLs. When false, return the request ID immediately.',
  },
  webhookUrl: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'HTTPS endpoint that Higgsfield notifies when the request finishes',
  },
  idempotencyKey: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Key that makes retries return the original request instead of creating a duplicate (1–255 visible ASCII characters)',
  },
  expiresAfter: {
    type: 'number',
    required: false,
    visibility: 'user-only',
    description:
      'Seconds to keep the request data after it finishes, from 3600 up to the account retention',
  },
} as const satisfies ToolConfig['params']

/** Builds an absolute Higgsfield API URL, skipping empty query values. */
export function buildHiggsfieldUrl(
  path: string,
  query: Record<string, string | number | null | undefined> = {}
): string {
  const url = new URL(`${HIGGSFIELD_API_BASE}${path}`)
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(name, String(value))
  }
  return url.toString()
}

/** Auth headers, plus a JSON content type for requests that send a body. */
export function higgsfieldHeaders(accessToken: string, hasBody = false): Record<string, string> {
  return {
    ...higgsfieldAuthHeaders(accessToken),
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** Validates a model endpoint ID such as `kling-video/v2.5-turbo/pro/text-to-video`. */
export function normalizeModelEndpoint(value: string): string {
  const endpoint = value.trim().replace(/^\/+|\/+$/g, '')
  if (!MODEL_ENDPOINT_PATTERN.test(endpoint) || endpoint.split('/').some((part) => part === '..')) {
    throw new Error(
      'Model endpoint must be a Higgsfield endpoint ID such as higgsfield-ai/soul/standard'
    )
  }
  return endpoint
}

/** Builds the URL and headers for a generation submission. */
export function buildGenerationRequest(endpoint: string, params: HiggsfieldGenerationParams) {
  const webhookUrl = params.webhookUrl?.trim()
  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    throw new Error('Webhook URL must use HTTPS')
  }
  return {
    url: buildHiggsfieldUrl(`/${endpoint}`, { hf_webhook: webhookUrl }),
    headers: {
      ...higgsfieldHeaders(params.accessToken, true),
      ...(params.idempotencyKey?.trim() ? { 'Idempotency-Key': params.idempotencyKey.trim() } : {}),
      ...(params.expiresAfter ? { 'Hf-Expires-After': String(params.expiresAfter) } : {}),
    },
  }
}

function urlOf(value: unknown): string | null {
  const url = toRecord(value).url
  return typeof url === 'string' ? url : null
}

function urlsOf(value: unknown): string[] {
  return toArray(value)
    .map(urlOf)
    .filter((url): url is string => url !== null)
}

/** Maps a request submission or status payload to the shared request output. */
export function mapHiggsfieldRequest(payload: unknown): HiggsfieldRequestOutput {
  const data = toRecord(payload)
  const requestId = data.request_id
  if (typeof requestId !== 'string' || !requestId) {
    throw new Error('Higgsfield response did not include a request_id')
  }
  return {
    requestId,
    status: typeof data.status === 'string' ? data.status : 'unknown',
    error: typeof data.error === 'string' ? data.error : null,
    imageUrls: urlsOf(data.images),
    videoUrl: urlOf(data.video),
    audioUrl: urlOf(data.audio),
    audioUrls: urlsOf(data.audios),
    statusUrl: typeof data.status_url === 'string' ? data.status_url : null,
    cancelUrl: typeof data.cancel_url === 'string' ? data.cancel_url : null,
    expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
  }
}

/** Maps a Soul ID character reference. */
export function mapHiggsfieldCharacter(payload: unknown): HiggsfieldCharacter {
  const data = toRecord(payload)
  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Higgsfield response did not include a character id')
  }
  return {
    id: data.id,
    name: typeof data.name === 'string' ? data.name : null,
    modelVersion: typeof data.model_version === 'string' ? data.model_version : null,
    status: typeof data.status === 'string' ? data.status : null,
    thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    createdAt: typeof data.created_at === 'string' ? data.created_at : null,
    inProgressAt: typeof data.in_progress_at === 'string' ? data.in_progress_at : null,
    failReason: typeof data.fail_reason === 'string' ? data.fail_reason : null,
  }
}

/**
 * Post-processes a generation submission: polls Get Request Status until the request reaches a
 * terminal state, unless the caller asked to return immediately.
 */
export async function waitForHiggsfieldRequest(
  result: HiggsfieldRequestResponse,
  params: HiggsfieldGenerationParams,
  executeTool: (toolId: string, params: Record<string, unknown>) => Promise<ToolResponse>
): Promise<HiggsfieldRequestResponse> {
  if (!result.success || params.waitForCompletion === false) return result

  let output = result.output
  try {
    const startedAt = Date.now()
    let attempt = 0
    while (!TERMINAL_REQUEST_STATUSES.has(output.status)) {
      if (Date.now() - startedAt >= MAX_POLL_TIME_MS) {
        logger.warn('Higgsfield request did not finish within the polling window', {
          requestId: output.requestId,
          status: output.status,
        })
        return {
          ...result,
          output,
          success: false,
          error: `Higgsfield request ${output.requestId} did not finish within ${MAX_POLL_TIME_MS / 1000}s (last status: ${output.status}). Use Get Request Status to check on it.`,
        }
      }
      attempt += 1
      await sleep(Math.min(POLL_INITIAL_INTERVAL_MS * attempt, POLL_MAX_INTERVAL_MS))

      const polled = (await executeTool('higgsfield_get_request_status', {
        accessToken: params.accessToken,
        requestId: output.requestId,
      })) as HiggsfieldRequestResponse
      if (!polled.success) {
        return {
          ...result,
          output,
          success: false,
          error: polled.error ?? 'Failed to check the Higgsfield request status',
        }
      }
      output = { ...output, ...polled.output }
    }
  } catch (error) {
    return {
      ...result,
      output,
      success: false,
      error: getErrorMessage(error, 'Failed to check the Higgsfield request status'),
    }
  }

  if (output.status !== 'completed') {
    return {
      ...result,
      output,
      success: false,
      error: higgsfieldFailureMessage(output.status, output.error),
    }
  }
  return { ...result, output }
}
