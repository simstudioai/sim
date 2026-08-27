import {
  MAX_JSON_API_RESPONSE_BYTES,
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GoogleDriveOperationError } from '@/lib/internal/google-drive/errors'

export interface GoogleDriveRequestOptions {
  accessToken: string
  body?: Buffer | string | Uint8Array
  headers?: Record<string, string>
  label: string
  maxResponseBytes?: number
  method?: string
  signal?: AbortSignal
  url: string
}

export async function requestGoogleDrive(
  options: GoogleDriveRequestOptions
): Promise<SecureFetchResponse> {
  options.signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(options.url, options.label)
  options.signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new GoogleDriveOperationError(400, {
      success: false,
      error: validation.error,
    })
  }

  return secureFetchWithPinnedIP(options.url, validation.resolvedIP!, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      ...options.headers,
    },
    body: options.body,
    maxResponseBytes: options.maxResponseBytes ?? MAX_JSON_API_RESPONSE_BYTES,
    redirectPolicy: {
      mode: 'standard',
      sendCredentialsOnCrossOriginRedirect: false,
    },
    signal: options.signal,
  })
}

export type JsonObject = Record<string, unknown>

export function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

export async function responseObject(response: SecureFetchResponse): Promise<JsonObject> {
  return asObject(await response.json())
}

export async function responseErrorObject(
  response: Pick<SecureFetchResponse, 'body'>,
  signal?: AbortSignal
): Promise<JsonObject> {
  try {
    const text = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Google Drive error response',
      signal,
    })
    return text ? asObject(JSON.parse(text)) : {}
  } catch {
    signal?.throwIfAborted()
    return {}
  }
}

export function googleApiErrorMessage(data: JsonObject, fallback: string): string {
  const error = asObject(data.error)
  return typeof error.message === 'string' && error.message ? error.message : fallback
}
