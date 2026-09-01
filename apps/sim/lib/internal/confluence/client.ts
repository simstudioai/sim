import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import { getConfluenceCloudId } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

export interface ConfluenceConnectionConfig {
  domain: string
  accessToken: string
  cloudId?: string
}

export type JsonObject = Record<string, unknown>

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function nested(object: JsonObject, ...keys: string[]): unknown {
  let value: unknown = object
  for (const key of keys) value = asObject(value)[key]
  return value
}

export function nextCursor(data: JsonObject): string | null {
  const next = nested(data, '_links', 'next')
  return typeof next === 'string'
    ? new URL(next, 'https://placeholder').searchParams.get('cursor')
    : null
}

export class ConfluenceClient {
  constructor(
    readonly cloudId: string,
    private readonly accessToken: string
  ) {}

  apiV2(path: string): string {
    return `https://api.atlassian.com/ex/confluence/${this.cloudId}/wiki/api/v2${path}`
  }

  rest(path: string): string {
    return `https://api.atlassian.com/ex/confluence/${this.cloudId}/wiki/rest/api${path}`
  }

  async fetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    return fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
      signal,
    })
  }

  async json(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<JsonObject> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) await throwConfluenceResponseError(response, signal)
    return readConfluenceResponseObject(response, signal)
  }

  async delete(path: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetch(path, { method: 'DELETE' }, signal)
    if (!response.ok) await throwConfluenceResponseError(response, signal)
    await readConfluenceResponseText(response, signal, 'Confluence delete response', 'DELETE')
  }
}

function waitForConfluenceCloudId(promise: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (cloudId) => {
        cleanup()
        resolve(cloudId)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })
}

export async function readConfluenceResponseText(
  response: Response,
  signal?: AbortSignal,
  label = 'Confluence response',
  requestMethod?: string
): Promise<string> {
  return readResponseTextWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label,
    requestMethod,
    signal,
  })
}

export async function readConfluenceResponseObject(
  response: Response,
  signal?: AbortSignal,
  label = 'Confluence response'
): Promise<JsonObject> {
  const text = await readConfluenceResponseText(response, signal, label)
  return text ? asObject(JSON.parse(text)) : {}
}

export async function throwConfluenceResponseError(
  response: Response,
  signal?: AbortSignal
): Promise<never> {
  const errorText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Confluence error response',
    signal,
  })
  throw new ConfluenceOperationError(
    parseAtlassianErrorMessage(response.status, response.statusText, errorText),
    response.status
  )
}

export async function createConfluenceClient(
  config: ConfluenceConnectionConfig,
  signal?: AbortSignal
): Promise<ConfluenceClient> {
  signal?.throwIfAborted()
  const cloudId =
    config.cloudId ||
    (await waitForConfluenceCloudId(
      getConfluenceCloudId(config.domain, config.accessToken),
      signal
    ))
  signal?.throwIfAborted()
  const validation = validateJiraCloudId(cloudId, 'cloudId')
  if (!validation.isValid) {
    throw new ConfluenceOperationError(validation.error || 'Invalid cloudId', 400)
  }
  return new ConfluenceClient(validation.sanitized ?? cloudId, config.accessToken)
}
