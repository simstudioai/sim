import type { CliAuthScope } from '@/lib/api/contracts/cli-auth'

/** BASE64URL, 43 chars (request id or SHA-256 challenge), no padding. */
const BASE64URL_43 = /^[A-Za-z0-9\-_]{43}$/

/** `XXXX-XXXX` over an alphabet with no look-alike characters. */
const PAIRING_PATTERN =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/

export interface CliAuthRequest {
  /** Rendezvous handle the CLI polls on; echoed back on approval. */
  request: string
  /** SHA-256 challenge; the CLI proves the matching secret when it polls. */
  challenge: string
  /** Printed by the CLI, rendered for eyeball comparison. Never sent to the API. */
  pairing: string
  /** Which key space the terminal is asking for. */
  scope: CliAuthScope
  /** Workspace the terminal suggests preselecting. A hint only — never authority. */
  suggestedWorkspaceId: string | null
}

export type CliAuthRequestResolution =
  | { valid: true; request: CliAuthRequest }
  | { valid: false; reason: string }

interface RawCliAuthParams {
  request: string | null
  challenge: string | null
  pairing: string | null
  scope: CliAuthScope
  workspace: string | null
}

/**
 * Shared by the server page (which refuses to bounce an invalid request through
 * login) and the client view (which renders the reason).
 */
export function resolveCliAuthRequest({
  request,
  challenge,
  pairing,
  scope,
  workspace,
}: RawCliAuthParams): CliAuthRequestResolution {
  if (!request || !challenge || !pairing) {
    return { valid: false, reason: 'This link is missing the parameters the Sim CLI sends.' }
  }

  if (!BASE64URL_43.test(request) || !BASE64URL_43.test(challenge)) {
    return { valid: false, reason: 'This link is malformed.' }
  }

  if (!PAIRING_PATTERN.test(pairing)) {
    return { valid: false, reason: 'The pairing code is malformed.' }
  }

  return {
    valid: true,
    request: { request, challenge, pairing, scope, suggestedWorkspaceId: workspace || null },
  }
}
