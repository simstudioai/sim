import { defaultShouldDehydrateQuery, isServer, QueryClient } from '@tanstack/react-query'
import { isDesktopApp } from '@/lib/desktop'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        // The desktop app window lives for days, so cross-session changes —
        // an admin upgrading your org/workspace role, a workspace you were
        // auto-added to, seat/entitlement changes — would otherwise stay
        // stale until a manual reload (there is no push channel for them).
        // Refetch stale queries when the app window regains focus: the "user
        // came back after doing something elsewhere" signal, which is exactly
        // this bug class. staleTime still gates it, so rapid focus changes
        // cost nothing. Left off on the web, where tab-switch focus events are
        // frequent and noisy. Per-query overrides (e.g. useWorkspaceSchedules
        // pins this off) always win over this default.
        refetchOnWindowFocus: isDesktopApp(),
        retry: 1,
        retryOnMount: false,
      },
      mutations: {
        retry: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

/**
 * Returns a QueryClient instance. On the server, creates a new instance per request.
 * On the client, reuses a singleton instance.
 */
export function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}
