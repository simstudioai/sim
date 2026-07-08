import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type MothershipEnv = 'default' | 'dev' | 'staging' | 'prod'

const BASE = '/api/admin/mothership'

/**
 * Same-origin proxy to the mothership admin API. Both the request body and
 * the response shape vary per upstream `endpoint` query parameter, so a
 * single contract cannot capture the union; the proxy returns the upstream
 * JSON verbatim. `requestJson` would force a fixed response schema, so this
 * hook stays on raw `fetch` and surfaces upstream errors through `adminError`.
 */
async function mothershipPost(
  endpoint: string,
  environment: MothershipEnv,
  body?: Record<string, unknown>,
  signal?: AbortSignal
) {
  const qs = new URLSearchParams({ env: environment, endpoint })
  // boundary-raw-fetch: same-origin proxy whose response shape varies per upstream endpoint
  const res = await fetch(`${BASE}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.message || err.error || `Request failed (${res.status})`)
  }
  return res.json()
}

/**
 * Same-origin proxy GET for the mothership admin API. See `mothershipPost`
 * for the rationale on staying with raw `fetch`.
 */
async function mothershipGet(
  endpoint: string,
  environment: MothershipEnv,
  params?: Record<string, string>,
  signal?: AbortSignal
) {
  const qs = new URLSearchParams({ env: environment, endpoint, ...params })
  // boundary-raw-fetch: same-origin proxy whose response shape varies per upstream endpoint
  const res = await fetch(`${BASE}?${qs.toString()}`, { method: 'GET', signal })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.message || err.error || `Request failed (${res.status})`)
  }
  return res.json()
}

// Enterprise BYOK does NOT use the cross-env admin proxy. It talks to the
// workspace's own copilot (SIM_AGENT_API_URL — local in dev, prod copilot in
// prod) via a dedicated same-origin route that authenticates with the hosted
// internal key. So it always targets the copilot the mothership actually runs
// on, never a deployed dev/staging URL.
const BYOK_BASE = '/api/copilot/byok'

async function byokFetch(url: string, init?: RequestInit) {
  // boundary-raw-fetch: thin same-origin proxy to copilot; response shape is the
  // upstream copilot JSON.
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.message || err.error || `Request failed (${res.status})`)
  }
  return res.json()
}

export const MOTHERSHIP_BYOK_STALE_TIME = 30 * 1000
export const MOTHERSHIP_REQUESTS_STALE_TIME = 60 * 1000
export const MOTHERSHIP_USER_BREAKDOWN_STALE_TIME = 60 * 1000
export const MOTHERSHIP_LICENSE_LIST_STALE_TIME = 60 * 1000
export const MOTHERSHIP_LICENSE_DETAIL_STALE_TIME = 60 * 1000

export const mothershipKeys = {
  all: ['mothership-admin'] as const,
  requests: (env: MothershipEnv, start: string, end: string, userId?: string) =>
    [...mothershipKeys.all, 'requests', env, start, end, userId] as const,
  userBreakdown: (env: MothershipEnv, start: string, end: string) =>
    [...mothershipKeys.all, 'user-breakdown', env, start, end] as const,
  licenses: (env: MothershipEnv) => [...mothershipKeys.all, 'licenses', env] as const,
  licenseDetails: (env: MothershipEnv, id?: string, name?: string) =>
    [...mothershipKeys.all, 'license-details', env, id, name] as const,
  byok: (workspaceId: string) => [...mothershipKeys.all, 'byok', workspaceId] as const,
}

export interface MothershipByokKey {
  provider: string
  keyLastFour: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** List the enterprise BYOK keys stored for a workspace (metadata only). */
export function useMothershipByokKeys(workspaceId: string) {
  return useQuery({
    queryKey: mothershipKeys.byok(workspaceId),
    queryFn: ({ signal }) =>
      byokFetch(`${BYOK_BASE}?workspaceId=${encodeURIComponent(workspaceId)}`, { signal }),
    enabled: !!workspaceId,
    staleTime: MOTHERSHIP_BYOK_STALE_TIME,
  })
}

/** Store (or replace) a workspace's enterprise BYOK key for a provider. */
export function useUpsertMothershipByok() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { workspaceId: string; provider: string; apiKey: string }) =>
      byokFetch(BYOK_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    onSettled: (_data, _error, params) =>
      queryClient.invalidateQueries({ queryKey: mothershipKeys.byok(params.workspaceId) }),
  })
}

/** Delete a workspace's enterprise BYOK key for a provider. */
export function useDeleteMothershipByok() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { workspaceId: string; provider: string }) =>
      byokFetch(
        `${BYOK_BASE}?${new URLSearchParams({
          workspaceId: params.workspaceId,
          provider: params.provider,
        }).toString()}`,
        { method: 'DELETE' }
      ),
    onSettled: (_data, _error, params) =>
      queryClient.invalidateQueries({ queryKey: mothershipKeys.byok(params.workspaceId) }),
  })
}

export function useMothershipRequests(
  environment: MothershipEnv,
  start: string,
  end: string,
  userId?: string
) {
  return useQuery({
    queryKey: mothershipKeys.requests(environment, start, end, userId),
    queryFn: ({ signal }) =>
      mothershipPost(
        'requests',
        environment,
        {
          start,
          end,
          ...(userId ? { userId } : {}),
        },
        signal
      ),
    enabled: !!start && !!end,
    staleTime: MOTHERSHIP_REQUESTS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipUserBreakdown(environment: MothershipEnv, start: string, end: string) {
  return useQuery({
    queryKey: mothershipKeys.userBreakdown(environment, start, end),
    queryFn: ({ signal }) => mothershipPost('user-breakdown', environment, { start, end }, signal),
    enabled: !!start && !!end,
    staleTime: MOTHERSHIP_USER_BREAKDOWN_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipLicenses(environment: MothershipEnv) {
  return useQuery({
    queryKey: mothershipKeys.licenses(environment),
    queryFn: ({ signal }) => mothershipGet('licenses', environment, undefined, signal),
    staleTime: MOTHERSHIP_LICENSE_LIST_STALE_TIME,
  })
}

export function useMothershipLicenseDetails(
  environment: MothershipEnv,
  id?: string,
  name?: string
) {
  return useQuery({
    queryKey: mothershipKeys.licenseDetails(environment, id, name),
    queryFn: ({ signal }) =>
      mothershipPost(
        'licenses/details',
        environment,
        {
          ...(id ? { id } : {}),
          ...(name ? { name } : {}),
        },
        signal
      ),
    enabled: !!(id || name),
    staleTime: MOTHERSHIP_LICENSE_DETAIL_STALE_TIME,
  })
}

export function useGenerateLicense(environment: MothershipEnv) {
  return useMutation({
    mutationFn: (params: { name: string; expirationDate?: string }) =>
      mothershipPost('licenses/generate', environment, params),
  })
}
