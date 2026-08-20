import { spawnSync } from 'node:child_process'
import { sha256Base64Url } from '@sim/security/hash'
import { generateSecureToken } from '@sim/security/tokens'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import * as p from './prompter'
import { link, theme } from './theme'
import { SETUP_USER_AGENT } from './version'

const WAIT_MS = 900_000
const POLL_INTERVAL_MS = 2000
const POLL_REQUEST_TIMEOUT_MS = 15_000
const APPROVAL_PATH = '/cli/auth'
const POLL_PATH = '/api/cli/auth/poll'
const RETRYABLE_POLL_STATUSES = new Set([409, 429, 500, 502, 503, 504])
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type AuthPollResult =
  | { status: 'pending'; retryAfterMs?: number }
  | { status: 'complete'; apiKey: string }

/** Opens a safely encoded URL across platforms, including Windows' cmd-backed `start`. */
function openBrowser(url: string): void {
  if (process.env.SIM_SETUP_NO_BROWSER) return
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '""', `"${url}"`], {
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    })
    return
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  spawnSync(command, [url], { stdio: 'ignore' })
}

/** Short human-comparable code with no look-alike characters. */
function createPairingCode(): string {
  const chars = generateShortId(8, PAIRING_ALPHABET)
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

/** Validates the auth service root and preserves any path prefix it carries. */
export function normalizeAuthOrigin(origin: string): string {
  const value = origin.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(
      `Invalid Chat authorization origin "${origin}"; expected an absolute HTTP(S) URL.`
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Unsupported Chat authorization origin scheme "${parsed.protocol.replace(/:$/, '')}"; expected HTTP or HTTPS.`
    )
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Chat authorization origin cannot contain credentials, a query, or a fragment.')
  }
  const prefix = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${prefix}`
}

function authUrl(origin: string, path: string): string {
  return `${normalizeAuthOrigin(origin)}${path}`
}

/** Builds the browser URL without ever including the redeemable poll secret. */
export function buildApprovalUrl(
  origin: string,
  request: string,
  challenge: string,
  pairing: string
): string {
  const query = new URLSearchParams({ request, challenge, pairing })
  return `${authUrl(origin, APPROVAL_PATH)}?${query}`
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'TimeoutError'
  )
}

async function responseError(response: Response): Promise<string> {
  const fallback = `Chat authorization failed with HTTP ${response.status}`
  const raw = await response.text()
  if (!raw) return fallback

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!isRecordLike(body)) return fallback
  if (typeof body.error === 'string' && body.error) return truncate(body.error, 500)
  if (isRecordLike(body.error) && typeof body.error.message === 'string' && body.error.message) {
    return truncate(body.error.message, 500)
  }
  if (typeof body.message === 'string' && body.message) return truncate(body.message, 500)
  return fallback
}

function redirectError(origin: string, response: Response): Error {
  const location = response.headers.get('location')?.trim()
  if (!location) {
    return new Error(
      `Chat authorization origin ${normalizeAuthOrigin(origin)} returned HTTP ${response.status} without a redirect target.`
    )
  }

  let target: URL
  try {
    target = new URL(location, `${normalizeAuthOrigin(origin)}/`)
  } catch {
    return new Error(
      `Chat authorization origin ${normalizeAuthOrigin(origin)} returned HTTP ${response.status} with an invalid redirect target.`
    )
  }
  return new Error(
    `Chat authorization origin redirected the key poll to ${target.href}. Set SIM_CLI_AUTH_ORIGIN to the final service URL; setup will not forward the poll secret across a redirect.`
  )
}

function parsePollResponse(raw: string): AuthPollResult {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error('Chat authorization service returned a non-JSON response.')
  }
  if (!isRecordLike(body) || (body.status !== 'pending' && body.status !== 'complete')) {
    throw new Error('Chat authorization service returned an invalid poll response.')
  }
  if (body.status === 'pending') return { status: 'pending' }
  if (!isRecordLike(body.key) || typeof body.key.apiKey !== 'string' || !body.key.apiKey) {
    throw new Error('Chat authorization completed without a valid API key.')
  }
  return { status: 'complete', apiKey: body.key.apiKey }
}

/** Performs one bounded poll, retrying only known transient transport and service failures. */
export async function pollOnce(
  origin: string,
  request: string,
  verifier: string,
  timeoutMs: number = POLL_REQUEST_TIMEOUT_MS
): Promise<AuthPollResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Poll timeout must be a positive whole number of milliseconds, got ${timeoutMs}.`
    )
  }
  let response: Response
  try {
    response = await fetch(authUrl(origin, POLL_PATH), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': SETUP_USER_AGENT,
      },
      body: JSON.stringify({ request, verifier }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
  } catch (error) {
    if (isRetryableTransportError(error)) return { status: 'pending' }
    throw error
  }

  if (response.status >= 300 && response.status <= 399) throw redirectError(origin, response)
  if (RETRYABLE_POLL_STATUSES.has(response.status)) {
    const retryAfterMs =
      response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : null
    return {
      status: 'pending',
      ...(retryAfterMs && retryAfterMs > 0 ? { retryAfterMs } : {}),
    }
  }
  if (!response.ok) throw new Error(await responseError(response))
  return parsePollResponse(await response.text())
}

/**
 * Opens the approval page and polls for the Chat key without a loopback listener.
 *
 * The poll secret never enters the browser URL. Fatal protocol and authorization
 * responses stop immediately; only known transient failures remain pending.
 */
export async function browserKeyFlow(origin: string): Promise<string | null> {
  const normalizedOrigin = normalizeAuthOrigin(origin)
  const request = generateSecureToken(32)
  const pollSecret = generateSecureToken(32)
  const challenge = sha256Base64Url(pollSecret)
  const pairingCode = createPairingCode()
  const approvalUrl = buildApprovalUrl(normalizedOrigin, request, challenge, pairingCode)

  p.note(
    `${theme.heading(pairingCode)}\n\n${theme.muted('The page should show this code. If it shows a different one,\nthe request is not from this terminal — close the tab.')}`,
    'Confirm this code in your browser'
  )
  p.log.info(
    `Opening your browser — create your account (or sign in) and approve; the key comes back automatically.\n   If it doesn't open: ${link(approvalUrl, approvalUrl)}`
  )
  openBrowser(approvalUrl)

  const spin = p.spinner()
  spin.start('Waiting for approval in your browser')

  const deadline = Date.now() + WAIT_MS
  let delayMs = POLL_INTERVAL_MS
  try {
    while (Date.now() < deadline) {
      const beforePollMs = deadline - Date.now()
      await sleep(Math.min(delayMs, beforePollMs))
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      const result = await pollOnce(
        normalizedOrigin,
        request,
        pollSecret,
        Math.min(POLL_REQUEST_TIMEOUT_MS, remainingMs)
      )
      if (result.status === 'complete') {
        spin.stop('Approved')
        return result.apiKey
      }
      delayMs = result.retryAfterMs ?? POLL_INTERVAL_MS
    }
  } catch (error) {
    spin.stop('Browser handoff failed')
    throw error
  }

  spin.stop('Browser handoff timed out')
  return null
}
