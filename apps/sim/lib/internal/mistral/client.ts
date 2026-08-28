import { createLogger } from '@sim/logger'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { readBoundedHttpErrorBody } from '@/lib/knowledge/documents/utils'

const logger = createLogger('MistralClient')
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/ocr'

export async function submitMistralOcr(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<unknown> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(
    MISTRAL_ENDPOINT,
    'Mistral API URL',
    'configuredEndpoint'
  )
  signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
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
    throw new MistralOperationError(response.status, {
      success: false,
      error: `Mistral API error: ${response.statusText}`,
    })
  }
  return response.json()
}
