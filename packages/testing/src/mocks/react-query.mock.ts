import { vi } from 'vitest'

/**
 * A neutral `useQuery` result: the real shape of a query that has not fetched yet
 * (`status: 'pending'`, `fetchStatus: 'idle'`, `data: undefined`). `overrides` replace fields.
 *
 * @example
 * ```ts
 * mockUseThings.mockReturnValue(createQueryResultMock({ data: [], status: 'success', isSuccess: true, isPending: false }))
 * ```
 */
export function createQueryResultMock(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined as unknown,
    error: null as unknown,
    status: 'pending',
    fetchStatus: 'idle',
    isPending: true,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    isPlaceholderData: false,
    isRefetching: false,
    refetch: vi.fn(async () => undefined),
    ...overrides,
  }
}

/**
 * A neutral `useMutation` result in the `idle` state. `mutate`/`reset` are no-op `vi.fn()`s and
 * `mutateAsync` resolves `undefined`. `overrides` replace fields.
 */
export function createMutationResultMock(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    reset: vi.fn(),
    data: undefined as unknown,
    error: null as unknown,
    variables: undefined as unknown,
    status: 'idle',
    isIdle: true,
    isPending: false,
    isError: false,
    isSuccess: false,
    submittedAt: 0,
    ...overrides,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * Stand-in `QueryClient` shared by `useQueryClient()` and `new QueryClient()`. Every method is a
 * `vi.fn()`: `invalidateQueries`/`cancelQueries`/`refetchQueries`/`resetQueries`/`prefetchQuery`
 * resolve `undefined`, `getQueryData` returns `undefined`, `getQueriesData`/`setQueriesData`
 * return `[]`, `fetchQuery`/`ensureQueryData` resolve `undefined`, the rest are no-ops.
 */
const mockQueryClient = {
  invalidateQueries: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  cancelQueries: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  refetchQueries: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  resetQueries: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  prefetchQuery: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  prefetchInfiniteQuery: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  fetchQuery: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  fetchInfiniteQuery: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  ensureQueryData: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  getQueryData: vi.fn((..._args: unknown[]): unknown => undefined),
  getQueriesData: vi.fn((..._args: unknown[]): unknown[] => []),
  setQueryData: vi.fn((..._args: unknown[]): unknown => undefined),
  setQueriesData: vi.fn((..._args: unknown[]): unknown[] => []),
  getQueryState: vi.fn((..._args: unknown[]): unknown => undefined),
  removeQueries: vi.fn(),
  clear: vi.fn(),
  isFetching: vi.fn((..._args: unknown[]): number => 0),
  isMutating: vi.fn((..._args: unknown[]): number => 0),
  getQueryCache: vi.fn(() => ({ find: vi.fn(), findAll: vi.fn(() => []), subscribe: vi.fn() })),
  getMutationCache: vi.fn(() => ({ find: vi.fn(), findAll: vi.fn(() => []), subscribe: vi.fn() })),
  getDefaultOptions: vi.fn(() => ({})),
  setDefaultOptions: vi.fn(),
  setQueryDefaults: vi.fn(),
  setMutationDefaults: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}

/**
 * Controllable mock functions for `@tanstack/react-query`.
 *
 * Defaults (everything else is a bare `vi.fn()` returning `undefined`):
 * - `mockUseQueryClient` / `mockQueryClientConstructor` return the shared {@link mockQueryClient}
 *   (exposed as `mockQueryClient`; its methods are `vi.fn()`s, see its TSDoc).
 * - `mockUseMutation` returns the options it was called with — the dominant local shape, so a
 *   hook-module test reads `mutationFn`/`onMutate`/`onSettled` off the hook's return value.
 * - `mockUseQuery`, `mockUseInfiniteQuery`, `mockUseSuspenseQuery`, `mockUseSuspenseInfiniteQuery`
 *   are bare: set a per-test return (e.g. {@link createQueryResultMock}) or read `mock.calls[0][0]`.
 * - `mockUseQueries`/`mockUseSuspenseQueries` return `[]`, `mockUseMutationState` returns `[]`,
 *   `mockUseIsFetching`/`mockUseIsMutating` return `0`, `mockUseIsRestoring` returns `false`.
 * - `mockDehydrate` returns `{}` (what every local returned), `mockHydrate` is a no-op.
 *
 * @example
 * ```ts
 * import { reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
 *
 * reactQueryMockFns.mockQueryClient.getQueryData.mockReturnValue([{ id: 'folder-1' }])
 * ```
 */
export const reactQueryMockFns = {
  mockQueryClient,
  mockUseQueryClient: vi.fn((..._args: unknown[]) => mockQueryClient),
  mockQueryClientConstructor: vi.fn(function QueryClient(..._args: unknown[]) {
    return mockQueryClient
  }),
  mockUseQuery: vi.fn(),
  mockUseInfiniteQuery: vi.fn(),
  mockUseSuspenseQuery: vi.fn(),
  mockUseSuspenseInfiniteQuery: vi.fn(),
  mockUseQueries: vi.fn((..._args: unknown[]): unknown[] => []),
  mockUseSuspenseQueries: vi.fn((..._args: unknown[]): unknown[] => []),
  mockUseMutation: vi.fn((options?: unknown) => options),
  mockUseMutationState: vi.fn((..._args: unknown[]): unknown[] => []),
  mockUseIsFetching: vi.fn((..._args: unknown[]): number => 0),
  mockUseIsMutating: vi.fn((..._args: unknown[]): number => 0),
  mockUseIsRestoring: vi.fn((): boolean => false),
  mockUsePrefetchQuery: vi.fn(),
  mockUsePrefetchInfiniteQuery: vi.fn(),
  mockUseQueryErrorResetBoundary: vi.fn(() => ({
    reset: vi.fn(),
    clearReset: vi.fn(),
    isReset: vi.fn(() => false),
  })),
  mockDehydrate: vi.fn((..._args: unknown[]): unknown => ({})),
  mockHydrate: vi.fn(),
  mockMatchQuery: vi.fn((..._args: unknown[]): boolean => true),
}

function passthrough({ children }: { children?: unknown }): unknown {
  return children ?? null
}

/**
 * Static mock module for `@tanstack/react-query`. Covers the package's own exports plus the
 * `@tanstack/query-core` re-exports `apps/sim` imports (`QueryClient`, `QueryObserver`,
 * `dehydrate`, `hydrate`, `hashKey`, `matchQuery`, `isServer`, `focusManager`,
 * `keepPreviousData`, `skipToken`). Pure helpers are faithful: `keepPreviousData` returns its
 * argument, `queryOptions`/`infiniteQueryOptions`/`mutationOptions` return their options,
 * `hashKey` is the real sorted-key `JSON.stringify`. Provider components render `children`
 * (`HydrationBoundary`, `QueryClientProvider`, `QueryErrorResetBoundary`, `IsRestoringProvider`).
 * No React dependency, so `QueryClientContext` is a plain `{ Provider, Consumer }` stub.
 *
 * @example
 * ```ts
 * vi.mock('@tanstack/react-query', () => reactQueryMock)
 * ```
 */
export const reactQueryMock = {
  QueryClient: reactQueryMockFns.mockQueryClientConstructor,
  QueryObserver: vi.fn(),
  QueryClientProvider: passthrough,
  HydrationBoundary: passthrough,
  QueryErrorResetBoundary: passthrough,
  IsRestoringProvider: passthrough,
  QueryClientContext: { Provider: passthrough, Consumer: passthrough },
  useQueryClient: reactQueryMockFns.mockUseQueryClient,
  useQuery: reactQueryMockFns.mockUseQuery,
  useInfiniteQuery: reactQueryMockFns.mockUseInfiniteQuery,
  useSuspenseQuery: reactQueryMockFns.mockUseSuspenseQuery,
  useSuspenseInfiniteQuery: reactQueryMockFns.mockUseSuspenseInfiniteQuery,
  useQueries: reactQueryMockFns.mockUseQueries,
  useSuspenseQueries: reactQueryMockFns.mockUseSuspenseQueries,
  useMutation: reactQueryMockFns.mockUseMutation,
  useMutationState: reactQueryMockFns.mockUseMutationState,
  useIsFetching: reactQueryMockFns.mockUseIsFetching,
  useIsMutating: reactQueryMockFns.mockUseIsMutating,
  useIsRestoring: reactQueryMockFns.mockUseIsRestoring,
  usePrefetchQuery: reactQueryMockFns.mockUsePrefetchQuery,
  usePrefetchInfiniteQuery: reactQueryMockFns.mockUsePrefetchInfiniteQuery,
  useQueryErrorResetBoundary: reactQueryMockFns.mockUseQueryErrorResetBoundary,
  queryOptions: <T>(options: T): T => options,
  infiniteQueryOptions: <T>(options: T): T => options,
  mutationOptions: <T>(options: T): T => options,
  keepPreviousData: <T>(previousData: T): T => previousData,
  skipToken: Symbol('skipToken'),
  dehydrate: reactQueryMockFns.mockDehydrate,
  hydrate: reactQueryMockFns.mockHydrate,
  matchQuery: reactQueryMockFns.mockMatchQuery,
  hashKey: (queryKey: readonly unknown[]): string =>
    JSON.stringify(queryKey, (_key, value: unknown) =>
      isPlainObject(value)
        ? Object.keys(value)
            .sort()
            .reduce<Record<string, unknown>>((result, key) => {
              result[key] = value[key]
              return result
            }, {})
        : value
    ),
  isServer: typeof window === 'undefined' || 'Deno' in globalThis,
  focusManager: {
    isFocused: vi.fn(() => true),
    setFocused: vi.fn(),
    setEventListener: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onFocus: vi.fn(),
  },
}
