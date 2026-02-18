import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { MeshThreadsResponse } from '@/app/api/mesh/threads/route'
import type { MeshThreadDetail } from '@/app/api/mesh/threads/[contextId]/route'

export type { MeshThreadsResponse, MeshThreadDetail }
export type { MeshThread, MeshAgent } from '@/app/api/mesh/threads/route'
export type { MeshMessage } from '@/app/api/mesh/threads/[contextId]/route'

export const meshKeys = {
  all: ['mesh'] as const,
  threads: () => [...meshKeys.all, 'threads'] as const,
  threadList: (limit: number, offset: number) =>
    [...meshKeys.threads(), { limit, offset }] as const,
  details: () => [...meshKeys.all, 'detail'] as const,
  detail: (contextId: string | undefined) =>
    [...meshKeys.details(), contextId ?? ''] as const,
}

async function fetchMeshThreads(
  limit: number,
  offset: number
): Promise<MeshThreadsResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  })

  const response = await fetch(`/api/mesh/threads?${params.toString()}`)

  if (!response.ok) {
    throw new Error('Failed to fetch mesh threads')
  }

  return response.json()
}

async function fetchMeshThreadDetail(contextId: string): Promise<MeshThreadDetail> {
  const response = await fetch(`/api/mesh/threads/${contextId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch mesh thread detail')
  }

  return response.json()
}

interface UseMeshThreadsOptions {
  limit?: number
  offset?: number
  enabled?: boolean
  refetchInterval?: number | false
}

/**
 * Hook for fetching mesh conversation threads.
 */
export function useMeshThreads(options?: UseMeshThreadsOptions) {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  return useQuery({
    queryKey: meshKeys.threadList(limit, offset),
    queryFn: () => fetchMeshThreads(limit, offset),
    enabled: options?.enabled ?? true,
    staleTime: 10 * 1000,
    refetchInterval: options?.refetchInterval ?? false,
    placeholderData: keepPreviousData,
  })
}

/**
 * Hook for fetching a single mesh thread with full message history.
 */
export function useMeshThreadDetail(contextId: string | undefined) {
  return useQuery({
    queryKey: meshKeys.detail(contextId),
    queryFn: () => fetchMeshThreadDetail(contextId as string),
    enabled: Boolean(contextId),
    staleTime: 5 * 1000,
    placeholderData: keepPreviousData,
  })
}
