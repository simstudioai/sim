import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'

export type MothershipEnv = 'dev' | 'staging' | 'prod'

const BASE = '/api/admin/mothership'

async function mothershipPost(
  endpoint: string,
  environment: MothershipEnv,
  body?: Record<string, unknown>
) {
  const res = await fetch(`${BASE}?env=${environment}&endpoint=${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.message || err.error || `Request failed (${res.status})`)
  }
  return res.json()
}

async function mothershipGet(
  endpoint: string,
  environment: MothershipEnv,
  params?: Record<string, string>
) {
  const qs = new URLSearchParams({ env: environment, endpoint, ...params })
  const res = await fetch(`${BASE}?${qs.toString()}`, { method: 'GET' })
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
    queryFn: () =>
      mothershipPost('requests', environment, {
        start,
        end,
        ...(userId ? { userId } : {}),
      }),
    enabled: !!start && !!end,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipUserBreakdown(environment: MothershipEnv, start: string, end: string) {
  return useQuery({
    queryKey: mothershipKeys.userBreakdown(environment, start, end),
    queryFn: () => mothershipPost('user-breakdown', environment, { start, end }),
    enabled: !!start && !!end,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipLicenses(environment: MothershipEnv) {
  return useQuery({
    queryKey: mothershipKeys.licenses(environment),
    queryFn: () => mothershipGet('licenses', environment),
  })
}

export function useMothershipLicenseDetails(
  environment: MothershipEnv,
  id?: string,
  name?: string
) {
  return useQuery({
    queryKey: mothershipKeys.licenseDetails(environment, id, name),
    queryFn: () =>
      mothershipPost('licenses/details', environment, {
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
      }),
    enabled: !!(id || name),
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
    queryFn: () => mothershipPost('enterprise-stats', environment, { customerType, start, end }),
    enabled: !!customerType && !!start && !!end,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipTrace(environment: MothershipEnv, requestId: string) {
  return useQuery({
    queryKey: mothershipKeys.trace(environment, requestId),
    queryFn: () => mothershipGet('traces', environment, { requestId }),
    enabled: !!requestId,
  })
}
