import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getSecretSourceContract,
  type SaveOrganizationSecretsBody,
  saveOrganizationSecretsContract,
} from '@/lib/api/contracts/organization-secrets'
import {
  ORGANIZATION_SECRET_STALE_TIME,
  organizationSecretKeys,
} from '@/hooks/queries/utils/organization-secret-keys'

export function useOrganizationSecretSource(organizationId: string) {
  return useQuery({
    queryKey: organizationSecretKeys.source(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getSecretSourceContract, { params: { id: organizationId }, signal }),
    staleTime: ORGANIZATION_SECRET_STALE_TIME,
    enabled: Boolean(organizationId),
  })
}

export function useSaveOrganizationSecrets(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (body: SaveOrganizationSecretsBody) =>
      requestJson(saveOrganizationSecretsContract, { params: { id: organizationId }, body }),
    onSuccess: (_data, body) =>
      queryClient.invalidateQueries({
        queryKey: organizationSecretKeys.environment(organizationId, body.mode),
      }),
  })
}
