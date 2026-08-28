import {
  type ReadResponseWithLimitOptions,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GmailOperationError } from '@/lib/internal/gmail/errors'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const GMAIL_METADATA_RESPONSE_MAX_BYTES = 1024 * 1024
const RESPONSE_LIMIT: ReadResponseWithLimitOptions = {
  maxBytes: GMAIL_METADATA_RESPONSE_MAX_BYTES,
  label: 'Gmail API response',
}

export type JsonObject = Record<string, unknown>

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function nested(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) current = asObject(current)[key]
  return current
}

export class GmailClient {
  constructor(private readonly accessToken: string) {}

  api(path: string): string {
    return `${GMAIL_API_BASE}${path}`
  }

  async fetch(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal,
    })
  }

  async json(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<JsonObject> {
    const response = await this.fetch(path, init, signal)
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new GmailOperationError(`Gmail API error: ${response.statusText}`, response.status, {
        success: false,
        error: `Gmail API error: ${response.statusText}`,
      })
    }
    return asObject(await readResponseJsonWithLimit(response, RESPONSE_LIMIT))
  }

  async threadingHeaders(
    messageId: string,
    signal?: AbortSignal
  ): Promise<{
    messageId?: string
    references?: string
    subject?: string
  }> {
    try {
      const query = new URLSearchParams({ format: 'metadata' })
      query.append('metadataHeaders', 'Message-ID')
      query.append('metadataHeaders', 'References')
      query.append('metadataHeaders', 'Subject')
      const response = await this.fetch(
        this.api(`/messages/${encodeURIComponent(messageId)}?${query}`),
        {},
        signal
      )
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return {}
      }
      const data = asObject(await readResponseJsonWithLimit(response, RESPONSE_LIMIT))
      const headers = asArray(nested(data, 'payload', 'headers')).map(asObject)
      const value = (name: string) => {
        const header = headers.find(
          (entry) => typeof entry.name === 'string' && entry.name.toLowerCase() === name
        )
        return typeof header?.value === 'string' ? header.value : undefined
      }
      return {
        messageId: value('message-id'),
        references: value('references'),
        subject: value('subject'),
      }
    } catch {
      signal?.throwIfAborted()
      return {}
    }
  }
}
