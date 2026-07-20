import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { DecryptedApiKeyResult } from '@/lib/managed-agents/connections'
import {
  ANTHROPIC_API_BASE,
  ANTHROPIC_VERSION,
  MANAGED_AGENTS_BETA,
} from '@/lib/managed-agents/session-client'

const logger = createLogger('ManagedAgentProxy')

/**
 * Server-side proxy helper for the block-editor dropdowns
 * (`GET /v1/agents`, `/v1/environments`, `/v1/environments/{id}`,
 * `/v1/vaults`). Decrypted keys never touch the browser — the client
 * always calls the workspace-scoped proxy route, which in turn calls
 * Anthropic with the stored key.
 */
export async function proxyManagedAgentsGet<T>(
  apiKey: string,
  pathAndQuery: string,
  signal?: AbortSignal
): Promise<T> {
  const url = `${ANTHROPIC_API_BASE}${pathAndQuery}`
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': MANAGED_AGENTS_BETA,
    },
    signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    logger.warn('managed-agents proxy call failed', {
      pathAndQuery,
      status: resp.status,
      detail: detail.slice(0, 200),
    })
    throw new ManagedAgentProxyError(resp.status, detail.slice(0, 400))
  }
  return (await resp.json()) as T
}

export class ManagedAgentProxyError extends Error {
  readonly status: number
  readonly detail: string
  constructor(status: number, detail: string) {
    super(`Anthropic proxy call failed (HTTP ${status}): ${detail}`)
    this.name = 'ManagedAgentProxyError'
    this.status = status
    this.detail = detail
  }
}

/** Normalise Anthropic's `data: []` + `has_more` list pages into a flat array. */
export interface AnthropicListPage<T> {
  data?: T[]
  has_more?: boolean
  last_id?: string
}

/**
 * Map a {@link DecryptedApiKeyResult} failure to the correct HTTP
 * response for a proxy route. Keeps the "not_found → 404" and
 * "decrypt_failed → 502 + actionable message" mapping in one place so
 * every proxy route surfaces the same UX for the same failure mode.
 */
export function apiKeyFailureResponse(
  failure: Extract<DecryptedApiKeyResult, { ok: false }>
): NextResponse {
  if (failure.reason === 'decrypt_failed') {
    return NextResponse.json(
      {
        error:
          'Managed Agent connection could not be decrypted — the workspace encryption key may have rotated. Rotate the API key in Settings → Managed Agents to re-encrypt.',
      },
      { status: 502 }
    )
  }
  return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
}
