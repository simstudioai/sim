import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'

export interface GeneratedCopilotApiKey {
  id: string
  apiKey: string
}

/** Carries the upstream status so callers can mirror it instead of flattening to 500. */
export class CopilotApiKeyError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number
  ) {
    super(message)
    this.name = 'CopilotApiKeyError'
  }
}

/**
 * The single issuer for both callers: the settings UI, which authenticates by
 * session, and the CLI token exchange, which authenticates by a redeemed
 * authorization code. Throws so callers decide the status code.
 */
export async function generateCopilotApiKey(
  userId: string,
  name: string
): Promise<GeneratedCopilotApiKey> {
  const mothershipBaseURL = await getMothershipBaseURL({ userId })

  const res = await fetchGo(`${mothershipBaseURL}/api/validate-key/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    },
    body: JSON.stringify({ userId, name }),
    spanName: 'sim → go /api/validate-key/generate',
    operation: 'generate_api_key',
    attributes: { [TraceAttr.UserId]: userId },
  })

  if (!res.ok) {
    throw new CopilotApiKeyError('Failed to generate copilot API key', res.status || 500)
  }

  const data = (await res.json().catch(() => null)) as { apiKey?: string; id?: string } | null
  if (!data?.apiKey) {
    throw new CopilotApiKeyError('Invalid response from Sim Agent', 500)
  }

  return { id: data.id || 'new', apiKey: data.apiKey }
}
