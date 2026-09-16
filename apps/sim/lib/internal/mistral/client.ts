import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  acquireProviderCapacity,
  type ProviderCapacityLease,
} from '@/lib/core/rate-limiter/provider-capacity'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { getMistralCapacityConfig, getMistralCapacityScope } from '@/lib/internal/mistral/capacity'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { MISTRAL_OCR_REQUEST_POLICY } from '@/lib/knowledge/documents/ocr-request-policy'
import { readBoundedHttpErrorBody, resolveRetryDelayMs } from '@/lib/knowledge/documents/utils'

const logger = createLogger('MistralClient')
const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/ocr'

export interface MistralCapacityOptions {
  /** Measured by trusted ingestion code, never accepted from a tool's wire input. */
  expectedPages?: number
  maxAdmissionWaitMs?: number
}

/** Unknown document URLs reserve the provider's maximum; selected pages and images have known cost. */
function requestPages(body: Record<string, unknown>, expectedPages?: number): number {
  if (expectedPages !== undefined) return expectedPages
  if (Array.isArray(body.pages) && body.pages.length > 0) return body.pages.length
  const document = body.document
  if (
    typeof document === 'object' &&
    document !== null &&
    'type' in document &&
    document.type === 'image_url'
  )
    return 1
  return MISTRAL_OCR_REQUEST_POLICY.maxPages
}

/** Admission, DNS, transport and body reads share an enforced deadline and one request lease. */
export async function submitMistralOcr(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  deadlineAt = Date.now() + 120_000,
  capacity: MistralCapacityOptions = {}
): Promise<unknown> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException('Mistral OCR request deadline exceeded', 'TimeoutError')),
    Math.max(0, deadlineAt - Date.now())
  )
  let lease: ProviderCapacityLease | undefined
  let outcome: 'success' | 'rate_limit' | 'failure' = 'failure'
  let retryAfterMs: number | undefined
  let removeAbortListener = () => {}
  try {
    if (Date.now() >= deadlineAt) {
      throw new ProviderCapacityDeferredError('provider_timeout', { providerId: 'mistral' })
    }
    const config = getMistralCapacityConfig()
    const pages = requestPages(body, capacity.expectedPages)
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > MISTRAL_OCR_REQUEST_POLICY.maxPages) {
      throw new MistralOperationError(400, { success: false, error: 'Invalid OCR page count' })
    }
    if (pages > config.pagesPerMinute) {
      throw new MistralOperationError(400, {
        success: false,
        error:
          'OCR request exceeds the configured page budget. Select a smaller page range or increase KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE to match the organization limit. Documents with an unknown page count reserve 1000 pages.',
      })
    }
    lease = await acquireProviderCapacity({
      providerId: 'mistral',
      scope: getMistralCapacityScope(apiKey),
      pages,
      config,
      deadlineAt,
      signal: requestSignal,
      maxWaitMs: capacity.maxAdmissionWaitMs ?? Math.max(1, deadlineAt - Date.now()),
    })
    requestSignal.throwIfAborted()
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(requestSignal.reason)
      requestSignal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => requestSignal.removeEventListener('abort', onAbort)
    })
    const request = async () => {
      const validation = await validateUrlWithDNS(
        MISTRAL_ENDPOINT,
        'Mistral API URL',
        'configuredEndpoint'
      )
      requestSignal.throwIfAborted()
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
        signal: requestSignal,
      })
      requestSignal.throwIfAborted()
      if (!response.ok) {
        retryAfterMs = resolveRetryDelayMs(response.headers)
        if (response.status === 429) {
          outcome = 'rate_limit'
          retryAfterMs = Math.max(retryAfterMs ?? 0, 1000)
          /** Record feedback before diagnostic body reads can stall or hit the request deadline. */
          try {
            retryAfterMs = Math.max(retryAfterMs, await lease!.settle('rate_limit', retryAfterMs))
          } catch (cause) {
            throw new ProviderCapacityDeferredError('admission_unavailable', {
              providerId: 'mistral',
              retryAfterMs,
              cause,
            })
          }
          void response.body?.cancel().catch(() => {})
          throw new ProviderCapacityDeferredError('rate_limit', {
            providerId: 'mistral',
            retryAfterMs,
          })
        }
        await readBoundedHttpErrorBody(response)
        logger.error('Mistral API error', { status: response.status })
        throw new MistralOperationError(
          response.status,
          { success: false, error: `Mistral API error: HTTP ${response.status}` },
          retryAfterMs,
          'provider'
        )
      }
      const output: unknown = await response.json()
      requestSignal.throwIfAborted()
      outcome = 'success'
      return output
    }
    return await Promise.race([request(), aborted])
  } catch (error) {
    signal?.throwIfAborted()
    if (controller.signal.aborted) {
      throw new ProviderCapacityDeferredError('provider_timeout', {
        providerId: 'mistral',
        retryAfterMs: 60_000,
        cause: error,
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
    removeAbortListener()
    if (lease) {
      try {
        await lease.settle(outcome, retryAfterMs)
      } catch (error) {
        /** Expiring leases bound crashed/unreachable releases; a provider call is never repeated here. */
        logger.warn('Could not settle Mistral capacity lease', {
          errorType: toError(error).name,
          outcome,
        })
      }
    }
  }
}
