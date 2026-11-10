import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  generateMothershipLicenseContract,
  type MothershipAdminEnv,
  mothershipLicenseListContract,
  mothershipRequestListContract,
  mothershipUserBreakdownContract,
} from '@/lib/api/contracts/mothership-admin'

export type MothershipEnv = MothershipAdminEnv

export const MOTHERSHIP_REQUESTS_STALE_TIME = 60 * 1000
export const MOTHERSHIP_USER_BREAKDOWN_STALE_TIME = 60 * 1000
export const MOTHERSHIP_LICENSE_LIST_STALE_TIME = 60 * 1000

export const mothershipKeys = {
  all: ['mothership-admin'] as const,
  requests: (env: MothershipEnv, start: string, end: string, userId?: string) =>
    [...mothershipKeys.all, 'requests', env, start, end, userId] as const,
  userBreakdown: (env: MothershipEnv, start: string, end: string) =>
    [...mothershipKeys.all, 'user-breakdown', env, start, end] as const,
  licenses: (env: MothershipEnv) => [...mothershipKeys.all, 'licenses', env] as const,
  licenseDetails: (env: MothershipEnv, id?: string, name?: string) =>
    [...mothershipKeys.all, 'license-details', env, id, name] as const,
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
      requestJson(mothershipRequestListContract, {
        query: { env: environment },
        body: { start, end, ...(userId ? { userId } : {}) },
        signal,
      }),
    enabled: !!start && !!end,
    staleTime: MOTHERSHIP_REQUESTS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipUserBreakdown(environment: MothershipEnv, start: string, end: string) {
  return useQuery({
    queryKey: mothershipKeys.userBreakdown(environment, start, end),
    queryFn: ({ signal }) =>
      requestJson(mothershipUserBreakdownContract, {
        query: { env: environment },
        body: { start, end },
        signal,
      }),
    enabled: !!start && !!end,
    staleTime: MOTHERSHIP_USER_BREAKDOWN_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useMothershipLicenses(environment: MothershipEnv) {
  return useQuery({
    queryKey: mothershipKeys.licenses(environment),
    queryFn: ({ signal }) =>
      requestJson(mothershipLicenseListContract, { query: { env: environment }, signal }),
    staleTime: MOTHERSHIP_LICENSE_LIST_STALE_TIME,
  })
}

export function useGenerateLicense(environment: MothershipEnv) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; approvalReference: string; expirationDate?: string }) =>
      requestJson(generateMothershipLicenseContract, { query: { env: environment }, body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: mothershipKeys.licenses(environment) })
    },
  })
}
