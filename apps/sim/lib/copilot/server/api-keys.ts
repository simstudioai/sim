import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'

/**
 * Chat API key operations against the Sim Agent's `/api/validate-key/*`
 * endpoints.
 *
 * The single issuer and reader for every caller: the settings UI, which
 * authenticates by session, and the CLI token exchange, which authenticates by
 * a redeemed authorization code. Routes stay thin so the surface survives the
 * settings page being retired.
 */

export interface CopilotApiKeySummary {
  id: string
  /** Masked — the full key is only ever returned at creation. */
  displayKey: string
  name: string | null
  createdAt: string | null
  lastUsed: string | null
}

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

interface ValidateKeyCall {
  userId: string
  path: string
  operation: string
  body: Record<string, unknown>
  failure: string
  attributes?: Record<string, string>
}

/**
 * Shared request envelope. Every `/api/validate-key/*` endpoint is a POST
 * carrying `userId`, authenticated with the service key when one is configured
 * and traced under the same span naming.
 */
async function callValidateKey({
  userId,
  path,
  operation,
  body,
  failure,
  attributes,
}: ValidateKeyCall): Promise<unknown> {
  const mothershipBaseURL = await getMothershipBaseURL({ userId })

  const res = await fetchGo(`${mothershipBaseURL}/api/validate-key/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    },
    body: JSON.stringify({ userId, ...body }),
    spanName: `sim → go /api/validate-key/${path}`,
    operation,
    attributes: { [TraceAttr.UserId]: userId, ...attributes },
  })

  if (!res.ok) {
    throw new CopilotApiKeyError(failure, res.status || 500)
  }

  return res.json().catch(() => null)
}

export async function listCopilotApiKeys(userId: string): Promise<CopilotApiKeySummary[]> {
  const data = (await callValidateKey({
    userId,
    path: 'get-api-keys',
    operation: 'get_api_keys',
    body: {},
    failure: 'Failed to get keys',
  })) as
    | { id: string; apiKey: string; name?: string; createdAt?: string; lastUsed?: string }[]
    | null

  if (!Array.isArray(data)) {
    throw new CopilotApiKeyError('Invalid response from Sim Agent', 500)
  }

  return data.map((key) => ({
    id: key.id,
    displayKey: `•••••${(typeof key.apiKey === 'string' ? key.apiKey : '').slice(-6)}`,
    name: key.name || null,
    createdAt: key.createdAt || null,
    lastUsed: key.lastUsed || null,
  }))
}

export async function generateCopilotApiKey(
  userId: string,
  name: string
): Promise<GeneratedCopilotApiKey> {
  const data = (await callValidateKey({
    userId,
    path: 'generate',
    operation: 'generate_api_key',
    body: { name },
    failure: 'Failed to generate copilot API key',
  })) as { apiKey?: string; id?: string } | null

  if (!data?.apiKey) {
    throw new CopilotApiKeyError('Invalid response from Sim Agent', 500)
  }

  return { id: data.id || 'new', apiKey: data.apiKey }
}

export async function deleteCopilotApiKey(userId: string, apiKeyId: string): Promise<void> {
  const data = (await callValidateKey({
    userId,
    path: 'delete',
    operation: 'delete_api_key',
    body: { apiKeyId },
    failure: 'Failed to delete key',
    attributes: { [TraceAttr.ApiKeyId]: apiKeyId },
  })) as { success?: boolean } | null

  if (!data?.success) {
    throw new CopilotApiKeyError('Invalid response from Sim Agent', 500)
  }
}
