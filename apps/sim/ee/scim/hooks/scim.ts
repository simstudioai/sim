import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  configureScimConnectionContract,
  deleteScimGroupMappingContract,
  getScimConnectionContract,
  issueScimCredentialContract,
  listScimActivityContract,
  listScimGroupMappingsContract,
  reconcileScimConnectionContract,
  revokeScimCredentialContract,
  type ScimConnectionSettingsInput,
  type ScimGroupMappingBody,
  upsertScimGroupMappingContract,
} from '@/lib/api/contracts/organization-scim'

export const SCIM_CONNECTION_STALE_TIME = 30 * 1000
export const SCIM_MAPPINGS_STALE_TIME = 30 * 1000
/** Activity is a debugging surface; it polls while mounted so a sync in progress shows up without a reload. */
export const SCIM_ACTIVITY_STALE_TIME = 10 * 1000
export const SCIM_ACTIVITY_REFETCH_INTERVAL = 15 * 1000

export const scimKeys = {
  all: ['scim'] as const,
  connections: () => [...scimKeys.all, 'connection'] as const,
  connection: (organizationId?: string) =>
    [...scimKeys.connections(), organizationId ?? ''] as const,
  mappingLists: () => [...scimKeys.all, 'mappings'] as const,
  mappings: (organizationId?: string) =>
    [...scimKeys.mappingLists(), organizationId ?? ''] as const,
  activities: () => [...scimKeys.all, 'activity'] as const,
  activity: (organizationId?: string) => [...scimKeys.activities(), organizationId ?? ''] as const,
}

export function useScimConnection(organizationId?: string, enabled = true) {
  return useQuery({
    queryKey: scimKeys.connection(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getScimConnectionContract, { params: { id: organizationId as string }, signal }),
    enabled: Boolean(organizationId) && enabled,
    staleTime: SCIM_CONNECTION_STALE_TIME,
  })
}

export function useScimGroupMappings(organizationId?: string, enabled = true) {
  return useQuery({
    queryKey: scimKeys.mappings(organizationId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listScimGroupMappingsContract, {
        params: { id: organizationId as string },
        signal,
      })
      return data.groups
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: SCIM_MAPPINGS_STALE_TIME,
  })
}

export function useScimActivity(organizationId?: string, enabled = true) {
  return useQuery({
    queryKey: scimKeys.activity(organizationId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listScimActivityContract, {
        params: { id: organizationId as string },
        query: { limit: 50 },
        signal,
      })
      return data.entries
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: SCIM_ACTIVITY_STALE_TIME,
    refetchInterval: SCIM_ACTIVITY_REFETCH_INTERVAL,
  })
}

interface ConfigureScimConnectionVariables {
  organizationId: string
  status?: 'active' | 'disabled'
  settings?: ScimConnectionSettingsInput
}

export function useConfigureScimConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, ...body }: ConfigureScimConnectionVariables) =>
      requestJson(configureScimConnectionContract, { params: { id: organizationId }, body }),
    onSettled: (_data, _error, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

interface IssueScimCredentialVariables {
  organizationId: string
  expiresInDays?: number
}

export function useIssueScimCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, expiresInDays }: IssueScimCredentialVariables) =>
      requestJson(issueScimCredentialContract, {
        params: { id: organizationId },
        body: expiresInDays ? { expiresInDays } : {},
      }),
    onSettled: (_data, _error, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

interface RevokeScimCredentialVariables {
  organizationId: string
  credentialId: string
}

export function useRevokeScimCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, credentialId }: RevokeScimCredentialVariables) =>
      requestJson(revokeScimCredentialContract, { params: { id: organizationId, credentialId } }),
    onSettled: (_data, _error, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
    },
  })
}

interface UpsertScimGroupMappingVariables {
  organizationId: string
  body: ScimGroupMappingBody
}

export function useUpsertScimGroupMapping() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, body }: UpsertScimGroupMappingVariables) =>
      requestJson(upsertScimGroupMappingContract, { params: { id: organizationId }, body }),
    onSettled: (_data, _error, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.mappings(organizationId) })
    },
  })
}

interface DeleteScimGroupMappingVariables {
  organizationId: string
  mappingId: string
}

export function useDeleteScimGroupMapping() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, mappingId }: DeleteScimGroupMappingVariables) =>
      requestJson(deleteScimGroupMappingContract, { params: { id: organizationId, mappingId } }),
    onSettled: (_data, _error, { organizationId }) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.mappings(organizationId) })
    },
  })
}

export function useReconcileScimConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (organizationId: string) =>
      requestJson(reconcileScimConnectionContract, { params: { id: organizationId } }),
    onSettled: (_data, _error, organizationId) => {
      queryClient.invalidateQueries({ queryKey: scimKeys.connection(organizationId) })
      queryClient.invalidateQueries({ queryKey: scimKeys.mappings(organizationId) })
    },
  })
}
