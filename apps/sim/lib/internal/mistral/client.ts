import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import {
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { readBoundedHttpErrorBody, resolveRetryDelayMs } from '@/lib/knowledge/documents/utils'

const logger = createLogger('MistralClient')
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/ocr'

export async function submitMistralOcr(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  deadlineAt = Date.now() + 120_000
): Promise<unknown> {
  signal?.throwIfAborted()
  await waitForProviderAdmission({
    providerId: 'mistral',
    credentialFingerprint: sha256Hex(apiKey),
    operation: 'ocr',
    signal,
    maxWaitMs: Math.max(0, deadlineAt - Date.now()),
  })
  const validation = await validateUrlWithDNS(
    MISTRAL_ENDPOINT,
    'Mistral API URL',
    'configuredEndpoint'
  )
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new MistralOperationError(502, {
      success: false,
      error: 'Failed to reach Mistral API',
    })
  }

  const response = await secureFetchWithPinnedIP(MISTRAL_ENDPOINT, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    maxResponseBytes,
    signal,
  })
  signal?.throwIfAborted()
  if (!response.ok) {
    const diagnostic = await readBoundedHttpErrorBody(response)
    logger.error('Mistral API error', { status: response.status, diagnostic })
    if (response.status === 429) {
      await recordProviderCooldown(
        { providerId: 'mistral', credentialFingerprint: sha256Hex(apiKey), operation: 'ocr' },
        resolveRetryDelayMs(response.headers) ?? 1000
      )
    }
    throw new MistralOperationError(
      response.status,
      { success: false, error: `Mistral API error: ${response.statusText}` },
      resolveRetryDelayMs(response.headers)
    )
  }
  return response.json()
}
