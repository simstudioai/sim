/**
 * HTTP client for Sim's background executor routes. Every request carries the app partition's
 * own session cookie, which is the session the device registered under; Sim refuses any other.
 */

import { getErrorMessage } from '@sim/utils/errors'
import { parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import {
  type ClaimedDesktopCall,
  COMPLETION_MESSAGE_MAX_CHARS,
  type DesktopCompletionOutcome,
  type DesktopCompletionRequest,
  type DesktopDeviceRegistration,
  type DesktopExecutorTiming,
  type DesktopInboxItem,
  parseClaim,
  parseCompletionOutcome,
  parseInbox,
  parseRegistration,
} from '@/main/desktop-executor/protocol'

const REQUEST_TIMEOUT_MS = 15_000

/** A request Sim answered with a failure, or that never got an answer (`status` 0). */
export class DeviceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'DeviceRequestError'
  }

  /** The device's registration no longer holds for this session; it must register again. */
  get unregistered(): boolean {
    return this.status === 401
  }

  /** Worth retrying unchanged: no answer, a server fault, or a rate limit. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

type DeviceFetch = (url: string, init: RequestInit) => Promise<Response>

export interface DesktopExecutorClient {
  register(registration: DesktopDeviceRegistration): Promise<DesktopExecutorTiming>
  listInbox(): Promise<DesktopInboxItem[]>
  /** Opens the doorbell; the caller reads the event stream and aborts it to close. */
  openInboxStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>
  claim(toolCallId: string): Promise<ClaimedDesktopCall>
  renewLease(toolCallId: string, executionToken: string): Promise<void>
  complete(request: DesktopCompletionRequest): Promise<DesktopCompletionOutcome>
}

interface DesktopExecutorClientOptions {
  origin: () => string
  fetch: DeviceFetch
  deviceId: string
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`
}

export function createDesktopExecutorClient(
  options: DesktopExecutorClientOptions
): DesktopExecutorClient {
  const { deviceId } = options

  async function send(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await options.fetch(`${options.origin()}${path}`, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (error) {
      throw new DeviceRequestError(0, getErrorMessage(error))
    }
    if (!response.ok) {
      throw new DeviceRequestError(
        response.status,
        await errorMessage(response),
        parseRetryAfter(response.headers.get('retry-after'))
      )
    }
    return response
  }

  async function json(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    const response = await send(method, path, body)
    return response.json().catch(() => null)
  }

  function malformed(route: string): DeviceRequestError {
    return new DeviceRequestError(502, `Sim returned a malformed ${route} response`)
  }

  return {
    async register(registration) {
      const timing = parseRegistration(
        await json('POST', '/api/desktop/devices', { ...registration })
      )
      if (!timing) throw malformed('registration')
      return timing
    },
    async listInbox() {
      const items = parseInbox(
        await json('GET', `/api/desktop/inbox?deviceId=${encodeURIComponent(deviceId)}`)
      )
      if (!items) throw malformed('inbox')
      return items
    },
    async openInboxStream(signal) {
      let response: Response
      try {
        response = await options.fetch(
          `${options.origin()}/api/desktop/inbox/stream?deviceId=${encodeURIComponent(deviceId)}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'text/event-stream' },
            cache: 'no-store',
            signal,
          }
        )
      } catch (error) {
        throw new DeviceRequestError(0, getErrorMessage(error))
      }
      if (!response.ok || !response.body) {
        throw new DeviceRequestError(response.status, `Doorbell refused: HTTP ${response.status}`)
      }
      return response.body
    },
    async claim(toolCallId) {
      const claimed = parseClaim(
        toolCallId,
        await json('POST', '/api/desktop/tool/claim', { deviceId, toolCallId })
      )
      if (!claimed) throw malformed('claim')
      return claimed
    },
    async renewLease(toolCallId, executionToken) {
      await send('POST', '/api/desktop/tool/lease', { deviceId, toolCallId, executionToken })
    },
    async complete({ toolCallId, executionToken, completion }) {
      const outcome = parseCompletionOutcome(
        await json('POST', '/api/desktop/tool/complete', {
          deviceId,
          toolCallId,
          executionToken,
          status: completion.status,
          // Leaves room for the ellipsis, so a cut message still fits Sim's limit.
          message: truncate(completion.message, COMPLETION_MESSAGE_MAX_CHARS - 3),
          ...(completion.data !== undefined ? { data: completion.data } : {}),
        })
      )
      if (!outcome) throw malformed('completion')
      return outcome
    },
  }
}
