import { vi } from 'vitest'

/** Mirrors `RedirectType` in `next/navigation`. */
const RedirectType = { push: 'push', replace: 'replace' } as const

/**
 * Error thrown by the mocked `redirect`/`permanentRedirect`. The message is
 * `NEXT_REDIRECT:<url>` so tests can assert the destination with
 * `rejects.toThrow('NEXT_REDIRECT:/login')`; `digest` follows Next's
 * `NEXT_REDIRECT;<type>;<url>;<status>;` shape for code that inspects it.
 */
class MockRedirectError extends Error {
  readonly digest: string

  constructor(url: string, type: string, status: number) {
    super(`NEXT_REDIRECT:${url}`)
    this.name = 'RedirectError'
    this.digest = `NEXT_REDIRECT;${type};${url};${status};`
  }
}

/**
 * Error thrown by the mocked `notFound`/`forbidden`/`unauthorized`, with Next's
 * `NEXT_HTTP_ERROR_FALLBACK;<status>` digest. The message for `notFound` is
 * `NEXT_NOT_FOUND`.
 */
class MockHttpFallbackError extends Error {
  readonly digest: string

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpFallbackError'
    this.digest = `NEXT_HTTP_ERROR_FALLBACK;${status}`
  }
}

/**
 * The single router object every `useRouter()` call returns, so a component's
 * `router.push` and the test's assertion target are the same `vi.fn()`.
 */
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}

/**
 * Controllable mock functions for `next/navigation`.
 *
 * Defaults: `useRouter()` returns the stable {@link router}, `usePathname()` → `'/'`,
 * `useSearchParams()` → empty `URLSearchParams`, `useParams()` → `{}`,
 * `useSelectedLayoutSegment()` → `null`, `useSelectedLayoutSegments()` → `[]`.
 * `redirect`/`permanentRedirect` throw `NEXT_REDIRECT:<url>`; `notFound` throws
 * `NEXT_NOT_FOUND`; `forbidden`/`unauthorized` throw `NEXT_FORBIDDEN`/`NEXT_UNAUTHORIZED`.
 *
 * @example
 * ```ts
 * import { nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
 *
 * nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })
 * expect(nextNavigationMockFns.router.push).toHaveBeenCalledWith('/workspace/workspace-1')
 * await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login')
 * ```
 */
export const nextNavigationMockFns = {
  router,
  mockUseRouter: vi.fn(() => router),
  mockUsePathname: vi.fn((): string => '/'),
  mockUseSearchParams: vi.fn((): URLSearchParams => new URLSearchParams()),
  mockUseParams: vi.fn((): Record<string, string | string[]> => ({})),
  mockUseSelectedLayoutSegment: vi.fn((_parallelRouteKey?: string): string | null => null),
  mockUseSelectedLayoutSegments: vi.fn((_parallelRouteKey?: string): string[] => []),
  mockUseServerInsertedHTML: vi.fn(),
  mockRedirect: vi.fn((url: string, type: string = RedirectType.replace): never => {
    throw new MockRedirectError(url, type, 307)
  }),
  mockPermanentRedirect: vi.fn((url: string, type: string = RedirectType.replace): never => {
    throw new MockRedirectError(url, type, 308)
  }),
  mockNotFound: vi.fn((): never => {
    throw new MockHttpFallbackError('NEXT_NOT_FOUND', 404)
  }),
  mockForbidden: vi.fn((): never => {
    throw new MockHttpFallbackError('NEXT_FORBIDDEN', 403)
  }),
  mockUnauthorized: vi.fn((): never => {
    throw new MockHttpFallbackError('NEXT_UNAUTHORIZED', 401)
  }),
  mockUnstableRethrow: vi.fn((_error: unknown): void => {}),
  mockUnstableIsUnrecognizedActionError: vi.fn((): boolean => false),
}

/**
 * Static mock module for `next/navigation`.
 *
 * @example
 * ```ts
 * vi.mock('next/navigation', () => nextNavigationMock)
 * ```
 */
export const nextNavigationMock = {
  useRouter: nextNavigationMockFns.mockUseRouter,
  usePathname: nextNavigationMockFns.mockUsePathname,
  useSearchParams: nextNavigationMockFns.mockUseSearchParams,
  useParams: nextNavigationMockFns.mockUseParams,
  useSelectedLayoutSegment: nextNavigationMockFns.mockUseSelectedLayoutSegment,
  useSelectedLayoutSegments: nextNavigationMockFns.mockUseSelectedLayoutSegments,
  useServerInsertedHTML: nextNavigationMockFns.mockUseServerInsertedHTML,
  redirect: nextNavigationMockFns.mockRedirect,
  permanentRedirect: nextNavigationMockFns.mockPermanentRedirect,
  notFound: nextNavigationMockFns.mockNotFound,
  forbidden: nextNavigationMockFns.mockForbidden,
  unauthorized: nextNavigationMockFns.mockUnauthorized,
  unstable_rethrow: nextNavigationMockFns.mockUnstableRethrow,
  unstable_isUnrecognizedActionError: nextNavigationMockFns.mockUnstableIsUnrecognizedActionError,
  RedirectType,
  ReadonlyURLSearchParams: URLSearchParams,
  ServerInsertedHTMLContext: { Provider: ({ children }: { children?: unknown }) => children },
}
