import { vi } from 'vitest'

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Controllable mock functions for `@/lib/selectors/server/credentials`.
 *
 * `mockWaitForSelectorCredentialResolution` ports the real abortable wait (resolves with the
 * resolution, rejects with the signal's reason on abort). `mockAuthorizeSelectorCredential` and
 * `mockResolveSelectorOAuthAccessToken` are bare.
 *
 * @example
 * ```ts
 * import { selectorCredentialsMockFns } from '@sim/testing/mocks/selector-credentials.mock'
 *
 * selectorCredentialsMockFns.mockResolveSelectorOAuthAccessToken.mockResolvedValue('token')
 * ```
 */
export const selectorCredentialsMockFns = {
  mockWaitForSelectorCredentialResolution: vi.fn(
    <T>(resolution: Promise<T>, signal?: AbortSignal): Promise<T> => {
      if (!signal) return resolution
      if (signal.aborted) return Promise.reject(abortReason(signal))
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort)
          reject(abortReason(signal))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        resolution.then(
          (value) => {
            signal.removeEventListener('abort', onAbort)
            resolve(value)
          },
          (error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          }
        )
        if (signal.aborted) onAbort()
      })
    }
  ),
  mockAuthorizeSelectorCredential: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}

/**
 * Static mock module for `@/lib/selectors/server/credentials`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/selectors/server/credentials', () => selectorCredentialsMock)
 * ```
 */
export const selectorCredentialsMock = {
  waitForSelectorCredentialResolution:
    selectorCredentialsMockFns.mockWaitForSelectorCredentialResolution,
  authorizeSelectorCredential: selectorCredentialsMockFns.mockAuthorizeSelectorCredential,
  resolveSelectorOAuthAccessToken: selectorCredentialsMockFns.mockResolveSelectorOAuthAccessToken,
}
