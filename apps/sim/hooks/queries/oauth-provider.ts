import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthorizedAppsPage,
  listAuthorizedAppsContract,
  revokeAuthorizedAppContract,
} from '@/lib/api/contracts/user'
import { client } from '@/lib/auth/auth-client'

export const oauthProviderKeys = {
  all: ['oauth-provider'] as const,
  clients: () => [...oauthProviderKeys.all, 'client'] as const,
  client: (clientId?: string, authorizationRequestKey?: string) =>
    [...oauthProviderKeys.clients(), clientId ?? '', authorizationRequestKey ?? ''] as const,
  authorizedApps: () => [...oauthProviderKeys.all, 'authorized-apps'] as const,
  authorizedAppsList: (search: string) => [...oauthProviderKeys.authorizedApps(), search] as const,
}

export const AUTHORIZED_APPS_STALE_TIME = 30 * 1000

export function useAuthorizedApps(search = '') {
  return useInfiniteQuery({
    queryKey: oauthProviderKeys.authorizedAppsList(search),
    queryFn: ({ signal, pageParam }) =>
      requestJson(listAuthorizedAppsContract, {
        query: { search, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: AuthorizedAppsPage) => page.nextCursor ?? undefined,
    staleTime: AUTHORIZED_APPS_STALE_TIME,
  })
}

export function useRevokeAuthorizedApp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (clientId: string) =>
      requestJson(revokeAuthorizedAppContract, { params: { clientId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oauthProviderKeys.authorizedApps() })
    },
  })
}

/** A client's public registration: what the consent page names it. */
export interface OAuthPublicClient {
  clientId: string
  name: string | null
}

export const OAUTH_PUBLIC_CLIENT_STALE_TIME = 5 * 60 * 1000

/**
 * The Better Auth endpoints below are plugin catch-all routes, typed by the
 * `oauthProviderClient()` plugin rather than by a Sim contract, so they are
 * called through the auth client instead of `requestJson`.
 */
async function fetchPublicClient(
  clientId: string,
  signal?: AbortSignal
): Promise<OAuthPublicClient> {
  const { data, error } = await client.oauth2.publicClientPrelogin({
    client_id: clientId,
    fetchOptions: { signal },
  })
  if (error || !data) {
    throw new Error(error?.message ?? 'This app could not be found.')
  }
  return { clientId: data.client_id, name: data.client_name ?? null }
}

export function useOAuthPublicClient(clientId?: string, authorizationRequestKey?: string) {
  return useQuery({
    queryKey: oauthProviderKeys.client(clientId, authorizationRequestKey),
    queryFn: ({ signal }) => fetchPublicClient(clientId as string, signal),
    enabled: Boolean(clientId && authorizationRequestKey),
    staleTime: OAUTH_PUBLIC_CLIENT_STALE_TIME,
  })
}

/**
 * Records the user's decision and returns where the browser goes next: the
 * client's `redirect_uri` with an authorization code, or with
 * `error=access_denied` when declined. The signed authorize query travels in
 * the request body automatically (see `oauthProviderClient` in `auth-client`).
 */
export function useOAuthConsent() {
  return useMutation({
    mutationFn: async (accept: boolean): Promise<string> => {
      const { data, error } = await client.oauth2.consent({ accept })
      if (error || !data?.url) {
        throw new Error(error?.message ?? 'The authorization could not be completed.')
      }
      return data.url
    },
  })
}

/** Leaves the current account before restarting the authorization request at the login form. */
export function useOAuthSwitchAccount() {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await client.signOut()
      if (error) throw new Error(error.message ?? 'Could not sign out. Please try again.')
    },
  })
}
