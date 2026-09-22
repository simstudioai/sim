import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConfigureSecretSourceBody,
  configureSecretSourceContract,
  getOrganizationSecretsContract,
  getSecretSourceContract,
  removeSecretSourceContract,
  type SaveOrganizationSecretsBody,
  saveOrganizationSecretsContract,
} from '@/lib/api/contracts/organization-secrets'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'

export const ORGANIZATION_SECRET_STALE_TIME = 60 * 1000
export const organizationSecretKeys = {
  all: ['organization-secrets'] as const,
  sources: () => [...organizationSecretKeys.all, 'source'] as const,
  source: (organizationId: string) =>
    [...organizationSecretKeys.sources(), organizationId] as const,
  environments: (organizationId: string) =>
    [...organizationSecretKeys.all, 'environment', organizationId] as const,
  environment: (organizationId: string, mode: SecretSourceMode) =>
    [...organizationSecretKeys.environments(organizationId), mode] as const,
}

export function useOrganizationSecretSource(organizationId: string) {
  return useQuery({
    queryKey: organizationSecretKeys.source(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getSecretSourceContract, { params: { id: organizationId }, signal }),
    staleTime: ORGANIZATION_SECRET_STALE_TIME,
    enabled: Boolean(organizationId),
  })
}

export function useConfigureOrganizationSecretSource(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ConfigureSecretSourceBody) =>
      requestJson(configureSecretSourceContract, { params: { id: organizationId }, body }),
    onSuccess: (data) => {
      queryClient.setQueryData(organizationSecretKeys.source(organizationId), data)
      queryClient.removeQueries({ queryKey: organizationSecretKeys.environments(organizationId) })
    },
  })
}

export function useRemoveOrganizationSecretSource(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sourceId: string) =>
      requestJson(removeSecretSourceContract, {
        params: { id: organizationId },
        body: { sourceId },
      }),
    onSuccess: () => {
      queryClient.setQueryData(organizationSecretKeys.source(organizationId), { source: null })
      queryClient.removeQueries({ queryKey: organizationSecretKeys.environments(organizationId) })
    },
  })
}

export function useOrganizationSecrets(
  organizationId: string,
  mode: SecretSourceMode,
  enabled = true
) {
  return useQuery({
    queryKey: organizationSecretKeys.environment(organizationId, mode),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationSecretsContract, {
        params: { id: organizationId },
        query: { mode },
        signal,
      }),
    staleTime: ORGANIZATION_SECRET_STALE_TIME,
    enabled: Boolean(organizationId) && enabled,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

export function useSaveOrganizationSecrets(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveOrganizationSecretsBody) =>
      requestJson(saveOrganizationSecretsContract, { params: { id: organizationId }, body }),
    onSuccess: (_data, body) =>
      queryClient.invalidateQueries({
        queryKey: organizationSecretKeys.environment(organizationId, body.mode),
      }),
  })
}
