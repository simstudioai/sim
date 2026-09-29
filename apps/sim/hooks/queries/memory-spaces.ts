import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateMemorySpaceBody,
  createMemorySpaceContract,
  listMemorySpacesContract,
  type SelectMemorySpaceBody,
  selectMemorySpaceContract,
} from '@/lib/api/contracts/memory-spaces'

const MEMORY_SPACES_STALE_TIME = 10_000
export const memorySpacesKeys = {
  all: ['memory-spaces'] as const,
  list: (organizationId: string) => [...memorySpacesKeys.all, organizationId] as const,
}
export function useMemorySpaces(organizationId: string) {
  return useQuery({
    queryKey: memorySpacesKeys.list(organizationId),
    queryFn: ({ signal }) =>
      requestJson(listMemorySpacesContract, { params: { id: organizationId }, signal }),
    staleTime: MEMORY_SPACES_STALE_TIME,
  })
}
export function useCreateMemorySpace(organizationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateMemorySpaceBody) =>
      requestJson(createMemorySpaceContract, { params: { id: organizationId }, body }),
    onSuccess: () => client.invalidateQueries({ queryKey: memorySpacesKeys.list(organizationId) }),
  })
}
export function useSelectMemorySpace(organizationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: SelectMemorySpaceBody) =>
      requestJson(selectMemorySpaceContract, { params: { id: organizationId }, body }),
    onSuccess: () => client.invalidateQueries({ queryKey: memorySpacesKeys.list(organizationId) }),
  })
}
