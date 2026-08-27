/**
 * Shared scaffolding for the Managed Agent session-operation tools.
 *
 * Every operation authenticates the same way (a Claude Platform
 * service-account credential the executor resolves into `accessToken`) and
 * most address an existing session by id, so those parameter definitions and
 * the guard that reads them live here rather than being restated per tool.
 */

import type { ToolConfig } from '@/tools/types'

/** Credential picker value; the executor swaps it for `accessToken` at run time. */
export const CREDENTIAL_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-only',
  description: 'Claude Platform credential (Anthropic workspace API key) to act with.',
} as const

/** Decrypted workspace API key injected by the executor. Never set by the author. */
export const ACCESS_TOKEN_PARAM = {
  type: 'string',
  required: false,
  visibility: 'hidden',
  description: 'Workspace API key injected by the executor from the selected credential.',
} as const

export const SESSION_ID_PARAM = {
  type: 'string',
  required: true,
  visibility: 'user-or-llm',
  description: 'Anthropic session id (sesn_...) to act on.',
} as const

/**
 * `ToolConfig` requires a `request` shape even when `directExecution`
 * short-circuits the HTTP path, so every session-operation tool reuses this
 * inert stub instead of repeating it.
 */
export const UNUSED_REQUEST: ToolConfig['request'] = {
  url: () => '',
  method: 'POST',
  headers: () => ({}),
}

/** Params common to every session-operation tool. */
export interface ManagedAgentSessionParams {
  credential: string
  accessToken?: string
  sessionId?: string
}

/**
 * Validates the two things every session operation needs. Returns a message on
 * failure so each tool can surface it as a normal tool error rather than
 * throwing — a missing credential is an author mistake, not an exception.
 */
export function resolveSessionTarget(
  params: ManagedAgentSessionParams
): { ok: true; apiKey: string; sessionId: string } | { ok: false; error: string } {
  const apiKey = params.accessToken
  if (!apiKey) {
    return {
      ok: false,
      error: 'No Claude Platform credential is selected, or it could not be resolved.',
    }
  }
  const sessionId = params.sessionId?.trim()
  if (!sessionId) {
    return { ok: false, error: 'A session id is required.' }
  }
  return { ok: true, apiKey, sessionId }
}
