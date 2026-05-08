import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

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

export const mothershipKeys = {
  all: ['mothership-admin'] as const,
  requests: (env: MothershipEnv, start: string, end: string, userId?: string) =>
    [...mothershipKeys.all, 'requests', env, start, end, userId] as const,
  userBreakdown: (env: MothershipEnv, start: string, end: string) =>
    [...mothershipKeys.all, 'user-breakdown', env, start, end] as const,
  licenses: (env: MothershipEnv) => [...mothershipKeys.all, 'licenses', env] as const,
  licenseDetails: (env: MothershipEnv, id?: string, name?: string) =>
    [...mothershipKeys.all, 'license-details', env, id, name] as const,
  enterpriseStats: (env: MothershipEnv, customerType: string, start: string, end: string) =>
    [...mothershipKeys.all, 'enterprise-stats', env, customerType, start, end] as const,
  trace: (env: MothershipEnv, requestId: string) =>
    [...mothershipKeys.all, 'trace', env, requestId] as const,
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
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipUserBreakdown(environment: MothershipEnv, start: string, end: string) {
  return useQuery({
    queryKey: mothershipKeys.userBreakdown(environment, start, end),
    queryFn: ({ signal }) => mothershipPost('user-breakdown', environment, { start, end }, signal),
    enabled: !!start && !!end,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipLicenses(environment: MothershipEnv) {
  return useQuery({
    queryKey: mothershipKeys.licenses(environment),
    queryFn: ({ signal }) => mothershipGet('licenses', environment, undefined, signal),
    staleTime: 60 * 1000,
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
    staleTime: 60 * 1000,
  })
}

export function useGenerateLicense(environment: MothershipEnv) {
  return useMutation({
    mutationFn: (params: { name: string; expirationDate?: string }) =>
      mothershipPost('licenses/generate', environment, params),
  })
}

export function useMothershipEnterpriseStats(
  environment: MothershipEnv,
  customerType: string,
  start: string,
  end: string
) {
  return useQuery({
    queryKey: mothershipKeys.enterpriseStats(environment, customerType, start, end),
    queryFn: ({ signal }) =>
      mothershipPost('enterprise-stats', environment, { customerType, start, end }, signal),
    enabled: !!customerType && !!start && !!end,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipTrace(environment: MothershipEnv, requestId: string) {
  return useQuery({
    queryKey: mothershipKeys.trace(environment, requestId),
    queryFn: ({ signal }) => mothershipGet('traces', environment, { requestId }, signal),
    enabled: !!requestId,
    staleTime: 60 * 1000,
  })
}
