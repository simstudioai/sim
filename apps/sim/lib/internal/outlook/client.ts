import { getErrorMessage } from '@sim/utils/errors'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'

const MICROSOFT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const MICROSOFT_GRAPH_RESPONSE_MAX_BYTES = 10 * 1024 * 1024

export type OutlookJsonObject = Record<string, unknown>

export function asObject(value: unknown): OutlookJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as OutlookJsonObject)
    : {}
}

function parseJson(text: string): OutlookJsonObject {
  if (!text) return {}
  return asObject(JSON.parse(text))
}

function graphErrorMessage(data: OutlookJsonObject, fallback: string): string {
  const error = asObject(data.error)
  return typeof error.message === 'string' && error.message ? error.message : fallback
}

export class OutlookClient {
  constructor(private readonly accessToken: string) {}

  private url(path: string): string {
    return `${MICROSOFT_GRAPH_BASE_URL}${path}`
  }

  async json(
    path: string,
    init: RequestInit,
    fallbackError: string,
    signal?: AbortSignal
  ): Promise<OutlookJsonObject> {
    signal?.throwIfAborted()
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
      signal,
    })
    const text = await readResponseTextWithLimit(response, {
      maxBytes: MICROSOFT_GRAPH_RESPONSE_MAX_BYTES,
      label: 'Microsoft Graph response',
      signal,
    })
    signal?.throwIfAborted()

    let data: OutlookJsonObject
    try {
      data = parseJson(text)
    } catch (error) {
      if (!response.ok) throw new OutlookOperationError(fallbackError, response.status)
      throw new Error(getErrorMessage(error, 'Microsoft Graph returned invalid JSON'))
    }
    if (!response.ok) {
      throw new OutlookOperationError(graphErrorMessage(data, fallbackError), response.status)
    }
    return data
  }

  async empty(
    path: string,
    init: RequestInit,
    fallbackError: string,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted()
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
      signal,
    })
    if (!response.ok) {
      const text = await readResponseTextWithLimit(response, {
        maxBytes: MICROSOFT_GRAPH_RESPONSE_MAX_BYTES,
        label: 'Microsoft Graph error response',
        signal,
      })
      let data: OutlookJsonObject = {}
      try {
        data = parseJson(text)
      } catch {
        data = {}
      }
      throw new OutlookOperationError(graphErrorMessage(data, fallbackError), response.status)
    }
    await response.body?.cancel()
    signal?.throwIfAborted()
  }
}
