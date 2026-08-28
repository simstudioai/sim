import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { AsanaOperationError } from '@/lib/internal/asana/errors'

const ASANA_API_BASE_URL = 'https://app.asana.com/api/1.0'
const ASANA_RESPONSE_MAX_BYTES = 10 * 1024 * 1024

export type AsanaJsonObject = Record<string, unknown>

export function asObject(value: unknown): AsanaJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AsanaJsonObject)
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function providerErrorMessage(response: Response, text: string): string {
  let message = `Asana API error: ${response.status} ${response.statusText}`
  try {
    const data = asObject(JSON.parse(text))
    const firstError = asObject(asArray(data.errors)[0])
    if (Object.keys(firstError).length > 0) {
      const providerMessage =
        typeof firstError.message === 'string' && firstError.message ? firstError.message : message
      const help = typeof firstError.help === 'string' ? firstError.help : ''
      message = `${providerMessage} (${help})`
    }
  } catch {
    return message
  }
  return message
}

export class AsanaClient {
  constructor(private readonly accessToken: string) {}

  private url(path: string): string {
    return `${ASANA_API_BASE_URL}${path}`
  }

  private async fetch(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    return fetch(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        ...init.headers,
      },
      signal,
    })
  }

  private async read(response: Response, signal?: AbortSignal): Promise<string> {
    const text = await readResponseTextWithLimit(response, {
      maxBytes: ASANA_RESPONSE_MAX_BYTES,
      label: 'Asana API response',
      signal,
    })
    signal?.throwIfAborted()
    return text
  }

  async json(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<AsanaJsonObject> {
    const response = await this.fetch(path, init, signal)
    const text = await this.read(response, signal)
    if (!response.ok) {
      const error = providerErrorMessage(response, text)
      throw new AsanaOperationError(error, response.status, {
        success: false,
        error,
        details: text,
      })
    }
    return asObject(JSON.parse(text))
  }

  async empty(path: string, init: RequestInit, signal?: AbortSignal): Promise<void> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) {
      const text = await this.read(response, signal)
      const error = providerErrorMessage(response, text)
      throw new AsanaOperationError(error, response.status, {
        success: false,
        error,
        details: text,
      })
    }
    await response.body?.cancel()
    signal?.throwIfAborted()
  }
}
