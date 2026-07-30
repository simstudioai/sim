import { createHash, randomBytes, randomInt } from 'node:crypto'
import { SimApiError } from '../http/client.js'

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

export type CliAuthScope = 'copilot' | 'platform'

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
  scope: CliAuthScope,
  workspaceId?: string
): string {
  const url = new URL('/cli/auth', endpoint)
  url.searchParams.set('request', auth.request)
  url.searchParams.set('challenge', auth.challenge)
  url.searchParams.set('pairing', auth.pairing)
  url.searchParams.set('scope', scope)
  if (workspaceId) url.searchParams.set('workspace', workspaceId)
  return url.toString()
}

interface PollResponse {
  status: 'pending' | 'complete'
  key?: { id: string; apiKey: string }
  scope?: CliAuthScope
  workspaceId?: string | null
  workspaceBound?: boolean
}

/**
 * Polls until the user approves in the browser.
 *
 * Transport failures are swallowed and retried rather than aborting the login:
 * a laptop that slept, a VPN reconnecting, or a deploy rolling the server mid-
 * wait are all recoverable, and the approval sits in Redis with its own TTL. A
 * non-2xx *response*, by contrast, is the server refusing on purpose and is
 * surfaced immediately.
 */
export async function pollForKey(
  endpoint: string,
  auth: AuthRequest,
  signal?: AbortSignal
): Promise<MintedKey> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new SimApiError('Login cancelled.', 0)

    let response: Response | null = null
    try {
      response = await fetch(new URL('/api/cli/auth/poll', endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ request: auth.request, verifier: auth.pollSecret }),
        signal,
      })
    } catch {
      response = null
    }

    if (response) {
      const raw = await response.text()

      if (!response.ok) {
        // 429 is the poll cadence bumping the per-IP bucket, not a refusal —
        // back off and keep the login alive instead of making the user restart.
        if (response.status !== 429) {
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

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new SimApiError('Timed out waiting for browser approval.', 0)
}
