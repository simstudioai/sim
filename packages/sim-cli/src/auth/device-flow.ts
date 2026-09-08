import { createHash, randomBytes, randomInt } from 'node:crypto'
import { sleep } from '../helpers'
import { buildUrl, REDIRECT_STATUSES, redirectEndpoint, SimApiError } from '../http/client'
import { USER_AGENT } from '../version'

/**
 * The terminal half of the CLI key handoff.
 *
 * Shaped like OAuth's device authorization grant: the CLI mints a rendezvous id
 * and a secret, sends only the secret's SHA-256 challenge through the browser,
 * and redeems the key over its own TLS connection. The browser leg therefore
 * never carries anything redeemable, and no loopback listener is required —
 * which matters because the terminal is often not on the same machine as the
 * browser (SSH, containers, remote dev boxes).
 */

/** No look-alike characters: the human is comparing this across two screens. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 15 * 60 * 1000

/** The page the browser is sent to for approval. */
const APPROVAL_PATH = '/cli/auth'

/** The route the login poll targets; also the suffix a redirect target is measured against. */
const POLL_PATH = '/api/cli/auth/poll'

/**
 * Poll statuses that leave the approval still redeemable, so the login should
 * keep waiting rather than making the user restart the browser handoff.
 *
 * The poll route releases its mint reservation on any mint failure — its own
 * comment says "a later poll can retry" — so giving up on those threw away an
 * approval the user had already granted. A transient 5xx or a same-second name
 * conflict (409) is exactly that case.
 *
 * 429 is the poll cadence hitting the per-IP bucket, not a refusal.
 *
 * Everything else stays terminal: 400 means a malformed request id or verifier,
 * and 401/403/404 mean the server is refusing on purpose. Retrying those just
 * spins until the 15-minute timeout.
 */
const RETRYABLE_POLL_STATUSES = new Set([409, 429, 500, 502, 503, 504])

/**
 * Consecutive transport failures before the poll says so on stderr.
 *
 * Three at the 2s interval is about six seconds: past any single DNS, TLS, or
 * connection-reset blip, and far short of the point where someone starts
 * wondering whether their approval registered. An endpoint that nothing is
 * listening on fails every attempt, so it trips this within seconds instead of
 * looking exactly like a slow approval for the full 15 minutes.
 */
const TRANSPORT_FAILURES_BEFORE_WARNING = 3

type CliAuthScope = 'copilot' | 'platform'

export interface AuthRequest {
  /** Semi-public rendezvous handle; travels in the browser URL. */
  request: string
  /** Never leaves this process until the poll redeems it. */
  pollSecret: string
  /** BASE64URL(SHA256(pollSecret)), registered when the user approves. */
  challenge: string
  /** Printed for the user to compare against the browser. Never sent to the API. */
  pairing: string
}

export interface MintedKey {
  id: string
  apiKey: string
  scope: CliAuthScope
  /** The workspace picked in the browser — the profile's default target. */
  workspaceId: string | null
  /** Whether the key can *only* reach that workspace. */
  workspaceBound: boolean
}

/** 32 bytes of entropy, base64url — 43 characters, exactly what the contract accepts. */
function token(): string {
  return randomBytes(32).toString('base64url')
}

function pairingCode(): string {
  const draw = (count: number) =>
    Array.from({ length: count }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join(
      ''
    )
  return `${draw(4)}-${draw(4)}`
}

export function createAuthRequest(): AuthRequest {
  const pollSecret = token()
  return {
    request: token(),
    pollSecret,
    challenge: createHash('sha256').update(pollSecret, 'utf8').digest('base64url'),
    pairing: pairingCode(),
  }
}

export function buildApprovalUrl(
  endpoint: string,
  auth: AuthRequest,
  workspaceId?: string
): string {
  return buildUrl(endpoint, APPROVAL_PATH, {
    request: auth.request,
    challenge: auth.challenge,
    pairing: auth.pairing,
    scope: 'platform',
    workspace: workspaceId,
  })
}

interface PollResponse {
  status: 'pending' | 'complete'
  key?: { id: string; apiKey: string }
  scope?: CliAuthScope
  workspaceId?: string | null
  workspaceBound?: boolean
}

/**
 * Explains a redirected poll rather than following it.
 *
 * The same policy `SimClient` applies, for the same two reasons and one more:
 * a 301/302/303 rewrites this POST into a bodyless GET, which the route answers
 * `405` — the login then fails naming a method nobody chose — and a redirect
 * that IS followed hands `pollSecret`, the one redeemable value in the handoff,
 * to whatever origin `Location` names.
 */
function toRedirectError(endpoint: string, response: Response): SimApiError {
  const location = response.headers.get('location')?.trim()
  let target: URL | null = null
  if (location) {
    try {
      target = new URL(location, endpoint)
    } catch {
      target = null
    }
  }

  if (!target) {
    return new SimApiError(
      `${endpoint} answered the login poll with HTTP ${response.status} and no usable redirect target. Check the endpoint.`,
      response.status
    )
  }
  const refusal = `${endpoint} redirected the login poll to ${target.href}. The CLI does not follow redirects, because a redirect drops the request body and would carry the login secret to another origin.`
  const suggested = redirectEndpoint(endpoint, POLL_PATH, target)
  return new SimApiError(
    suggested
      ? `${refusal} Re-run with --endpoint ${suggested}, or run: sim configure --set-endpoint ${suggested}`
      : refusal,
    response.status
  )
}

/**
 * Polls until the user approves in the browser.
 *
 * Transport failures are swallowed and retried rather than aborting the login:
 * a laptop that slept, a VPN reconnecting, or a deploy rolling the server mid-
 * wait are all recoverable, and the approval sits in Redis with its own TTL. A
 * non-2xx *response*, by contrast, is the server refusing on purpose and is
 * surfaced immediately.
 *
 * Retried is not the same as unreported: once
 * {@link TRANSPORT_FAILURES_BEFORE_WARNING} attempts in a row fail to reach the
 * endpoint at all, the reason is printed once to stderr and the poll carries on.
 * Without it a typo'd endpoint was indistinguishable from a slow approval for
 * the entire 15-minute timeout.
 */
export async function pollForKey(
  endpoint: string,
  auth: AuthRequest,
  signal?: AbortSignal
): Promise<MintedKey> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let consecutiveTransportFailures = 0
  let warnedAboutTransport = false

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new SimApiError('Login cancelled.', 0)

    let response: Response | null = null
    try {
      response = await fetch(buildUrl(endpoint, POLL_PATH), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ request: auth.request, verifier: auth.pollSecret }),
        signal,
        redirect: 'manual',
      })
    } catch (cause) {
      response = null
      consecutiveTransportFailures++
      if (
        !warnedAboutTransport &&
        consecutiveTransportFailures >= TRANSPORT_FAILURES_BEFORE_WARNING
      ) {
        warnedAboutTransport = true
        process.stderr.write(
          `Still waiting: ${endpoint} is not answering the login poll (${(cause as Error).message}). Check the endpoint; retrying until you approve or the login times out.\n`
        )
      }
    }

    if (response) {
      consecutiveTransportFailures = 0

      if (REDIRECT_STATUSES.has(response.status)) throw toRedirectError(endpoint, response)

      const raw = await response.text()

      if (!response.ok) {
        if (!RETRYABLE_POLL_STATUSES.has(response.status)) {
          let message = `Login failed with status ${response.status}`
          try {
            const body = JSON.parse(raw) as { error?: unknown }
            if (typeof body.error === 'string') message = body.error
            else if (body.error && typeof body.error === 'object') {
              const detail = (body.error as { message?: unknown }).message
              if (typeof detail === 'string') message = detail
            }
          } catch {}
          throw new SimApiError(message, response.status)
        }
      } else {
        const body = JSON.parse(raw) as PollResponse
        if (body.status === 'complete' && body.key) {
          return {
            id: body.key.id,
            apiKey: body.key.apiKey,
            // Older servers answer without these; a key from a server that does
            // not know about scopes is a copilot key by definition.
            scope: body.scope ?? 'copilot',
            workspaceId: body.workspaceId ?? null,
            workspaceBound: body.workspaceBound === true,
          }
        }
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new SimApiError('Timed out waiting for browser approval.', 0)
}
