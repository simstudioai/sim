import { vi } from 'vitest'

/** Faithful copy of the production deterministic admission codes (`lib/core/admission/rejection`). */
const DETERMINISTIC_ADMISSION_REJECTION_CODES = new Set([
  'USAGE_LIMIT_EXCEEDED',
  'ACCOUNT_SUSPENDED',
])

/** Faithful copy of the production `PollAdmissionRefusedError`. */
class PollAdmissionRefusedError extends Error {
  constructor(result: { statusCode?: number; error?: string }) {
    super(`Execution admission refused (${result.statusCode}): ${result.error}`)
    this.name = 'PollAdmissionRefusedError'
  }
}

/**
 * Faithful copy of the production egress-outage test (`asOrchestrationError(error)?.code ===
 * 'unavailable'`): an `OutboundRoutingError`, or an `OrchestrationError` coded `unavailable`,
 * anywhere in the cause chain.
 */
function isSimOutage(error: unknown): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current.name === 'OutboundRoutingError') return true
    if (current.name === 'OrchestrationError') {
      return (current as Error & { code?: string }).code === 'unavailable'
    }
    current = current.cause
  }
  return false
}

/** Faithful copy of the production `PollFetchError`. */
class PollFetchError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message)
    this.name = 'PollFetchError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** Faithful copy of the production `isUncountedPollFailure`. */
function isUncountedPollFailure(error: unknown): boolean {
  return error instanceof PollAdmissionRefusedError || isSimOutage(error)
}

/**
 * Controllable mock functions for `@/lib/webhooks/polling/utils`.
 *
 * State writes (`markWebhookFailed`, `markWebhookSuccess`, `updateWebhookProviderConfig`,
 * `recordPollSourceFailure`) resolve `undefined`; `fetchActiveWebhooks` resolves `[]`;
 * `resolveOAuthCredential` is a bare `vi.fn()`. `throwIfAdmissionRefused`,
 * `isUncountedPollFailure`, and `skipUncountedPollFailure` keep production behavior so a poller's refusal path runs as it
 * does in production. Defaults are `vi.fn(impl)`, so `mockReset()` restores them.
 *
 * @example
 * ```ts
 * import { webhooksPollingUtilsMockFns } from '@sim/testing/mocks/webhooks-polling-utils.mock'
 *
 * webhooksPollingUtilsMockFns.mockResolveOAuthCredential.mockResolvedValue('access-token')
 * ```
 */
export const webhooksPollingUtilsMockFns = {
  mockIsPollBackedOff: vi.fn((_providerConfig: unknown, _now: number): boolean => false),
  mockThrowIfAdmissionRefused: vi.fn(
    (result: { code?: string; statusCode?: number; error?: string }): void => {
      if (result.code && DETERMINISTIC_ADMISSION_REJECTION_CODES.has(result.code)) {
        throw new PollAdmissionRefusedError(result)
      }
    }
  ),
  mockIsUncountedPollFailure: vi.fn(isUncountedPollFailure),
  mockSkipUncountedPollFailure: vi.fn((error: unknown, ..._args: unknown[]): 'skipped' | null =>
    isUncountedPollFailure(error) ? 'skipped' : null
  ),
  mockReadPollRetryAfterMs: vi.fn((_header: string | null, _body: string): number | null => null),
  mockClearPollBackoff: vi.fn((_providerConfig: unknown): Record<string, undefined> => ({})),
  mockRecordPollSourceFailure: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockMarkWebhookFailed: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockMarkWebhookSuccess: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockFetchActiveWebhooks: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  mockRunWithConcurrency: vi.fn(),
  mockUpdateWebhookProviderConfig: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockResolveOAuthCredential: vi.fn(),
}

/**
 * Static mock module for `@/lib/webhooks/polling/utils`. Covers every runtime export; the
 * error classes and `CONCURRENCY` are faithful copies of production.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/webhooks/polling/utils', () => webhooksPollingUtilsMock)
 * ```
 */
export const webhooksPollingUtilsMock = {
  CONCURRENCY: 10,
  PollAdmissionRefusedError,
  PollFetchError,
  isPollBackedOff: webhooksPollingUtilsMockFns.mockIsPollBackedOff,
  throwIfAdmissionRefused: webhooksPollingUtilsMockFns.mockThrowIfAdmissionRefused,
  isUncountedPollFailure: webhooksPollingUtilsMockFns.mockIsUncountedPollFailure,
  skipUncountedPollFailure: webhooksPollingUtilsMockFns.mockSkipUncountedPollFailure,
  readPollRetryAfterMs: webhooksPollingUtilsMockFns.mockReadPollRetryAfterMs,
  clearPollBackoff: webhooksPollingUtilsMockFns.mockClearPollBackoff,
  recordPollSourceFailure: webhooksPollingUtilsMockFns.mockRecordPollSourceFailure,
  markWebhookFailed: webhooksPollingUtilsMockFns.mockMarkWebhookFailed,
  markWebhookSuccess: webhooksPollingUtilsMockFns.mockMarkWebhookSuccess,
  fetchActiveWebhooks: webhooksPollingUtilsMockFns.mockFetchActiveWebhooks,
  runWithConcurrency: webhooksPollingUtilsMockFns.mockRunWithConcurrency,
  updateWebhookProviderConfig: webhooksPollingUtilsMockFns.mockUpdateWebhookProviderConfig,
  resolveOAuthCredential: webhooksPollingUtilsMockFns.mockResolveOAuthCredential,
}
