import {
  ANTHROPIC_API_BASE,
  ANTHROPIC_VERSION,
  MANAGED_AGENTS_BETA,
} from '@/lib/managed-agents/session-client'

/**
 * Probes `GET /v1/agents` with the given key to prove the key is valid and
 * scoped to a real Claude Platform workspace. On success we don't care about
 * the response body — a 2xx is proof enough. On failure the body is trimmed
 * to 200 chars and surfaced so the "Verify" button can render Anthropic's
 * actual message.
 */
export async function verifyAnthropicApiKey(
  apiKey: string,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/agents?limit=1`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': MANAGED_AGENTS_BETA,
    },
    signal,
  })
  if (resp.ok) return { ok: true }
  const detail = await resp.text().catch(() => '')
  const status = resp.status
  const message =
    status === 401 || status === 403
      ? 'Anthropic rejected the API key. Check that the key belongs to a Managed Agents-enabled workspace.'
      : `Anthropic verify failed (HTTP ${status}). ${detail.slice(0, 200)}`
  return { ok: false, error: message }
}
