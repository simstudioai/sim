import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ForkWorkspaceBody,
  forkWorkspaceContract,
  getForkDiffContract,
  getForkLineageContract,
  getForkMappingContract,
  getForkResourcesContract,
  type PromoteForkBody,
  promoteForkContract,
  type RollbackForkBody,
  rollbackForkContract,
  type UpdateForkMappingBody,
  updateForkMappingContract,
} from '@/lib/api/contracts/workspace-fork'
import type { WorkspacesResponse } from '@/lib/api/contracts/workspaces'
import { backgroundWorkKeys } from '@/hooks/queries/background-work'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { workspaceKeys } from '@/hooks/queries/workspace'

export type ForkDirection = 'push' | 'pull'

export const forkKeys = {
  all: ['workspace-fork'] as const,
  lineages: () => [...forkKeys.all, 'lineage'] as const,
  lineage: (workspaceId?: string) => [...forkKeys.lineages(), workspaceId ?? ''] as const,
  mappings: () => [...forkKeys.all, 'mapping'] as const,
  mapping: (workspaceId?: string, otherWorkspaceId?: string, direction?: ForkDirection) =>
    [...forkKeys.mappings(), workspaceId ?? '', otherWorkspaceId ?? '', direction ?? ''] as const,
  diffs: () => [...forkKeys.all, 'diff'] as const,
  diff: (workspaceId?: string, otherWorkspaceId?: string, direction?: ForkDirection) =>
    [...forkKeys.diffs(), workspaceId ?? '', otherWorkspaceId ?? '', direction ?? ''] as const,
  resourcesAll: () => [...forkKeys.all, 'resources'] as const,
  resources: (workspaceId?: string) => [...forkKeys.resourcesAll(), workspaceId ?? ''] as const,
}

export function useForkResources(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: forkKeys.resources(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getForkResourcesContract, { params: { id: workspaceId as string }, signal }),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 30 * 1000,
  })
}

export function useForkLineage(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: forkKeys.lineage(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getForkLineageContract, { params: { id: workspaceId as string }, signal }),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useForkWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { workspaceId: string; body: ForkWorkspaceBody }) =>
      requestJson(forkWorkspaceContract, { params: { id: vars.workspaceId }, body: vars.body }),
    onSuccess: (data) => {
      // Merge the new fork into the active list cache before invalidation so the
      // immediate navigation into it can't race a stale list and trip the
      // not-in-workspaces redirect (mirrors useCreateWorkspace).
      const newWorkspace = data.workspace
      queryClient.setQueryData<WorkspacesResponse>(workspaceKeys.list('active'), (previous) => {
        if (!previous) {
          return { workspaces: [newWorkspace], lastActiveWorkspaceId: null, creationPolicy: null }
        }
        if (previous.workspaces.some((w) => w.id === newWorkspace.id)) {
          return previous
        }
        return { ...previous, workspaces: [newWorkspace, ...previous.workspaces] }
      })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.adminLists() })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: forkKeys.lineages() })
      queryClient.invalidateQueries({ queryKey: backgroundWorkKeys.lists() })
    },
  })
}

export function useForkMapping(args: {
  workspaceId?: string
  otherWorkspaceId?: string
  direction: ForkDirection
  enabled?: boolean
}) {
  return useQuery({
    queryKey: forkKeys.mapping(args.workspaceId, args.otherWorkspaceId, args.direction),
    queryFn: ({ signal }) =>
      requestJson(getForkMappingContract, {
        params: { id: args.workspaceId as string },
        query: { otherWorkspaceId: args.otherWorkspaceId as string, direction: args.direction },
        signal,
      }),
    enabled: Boolean(args.workspaceId && args.otherWorkspaceId) && (args.enabled ?? true),
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useUpdateForkMapping() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { workspaceId: string; body: UpdateForkMappingBody }) =>
      requestJson(updateForkMappingContract, { params: { id: vars.workspaceId }, body: vars.body }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: forkKeys.mappings() })
      queryClient.invalidateQueries({ queryKey: forkKeys.diffs() })
    },
  })
}

export function useForkDiff(args: {
  workspaceId?: string
  otherWorkspaceId?: string
  direction: ForkDirection
  enabled?: boolean
}) {
  return useQuery({
    queryKey: forkKeys.diff(args.workspaceId, args.otherWorkspaceId, args.direction),
    queryFn: ({ signal }) =>
      requestJson(getForkDiffContract, {
        params: { id: args.workspaceId as string },
        query: { otherWorkspaceId: args.otherWorkspaceId as string, direction: args.direction },
        signal,
      }),
    enabled: Boolean(args.workspaceId && args.otherWorkspaceId) && (args.enabled ?? true),
    staleTime: 10 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function usePromoteFork() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { workspaceId: string; body: PromoteForkBody }) =>
      requestJson(promoteForkContract, { params: { id: vars.workspaceId }, body: vars.body }),
    onSettled: () => {
      // A sync changes lineage (undoable run), mappings, and the diff - not the
      // workspace's copyable resource inventory, so leave `resources` cached.
      queryClient.invalidateQueries({ queryKey: forkKeys.lineages() })
      queryClient.invalidateQueries({ queryKey: forkKeys.mappings() })
      queryClient.invalidateQueries({ queryKey: forkKeys.diffs() })
      queryClient.invalidateQueries({ queryKey: backgroundWorkKeys.lists() })
      // A sync rewrites the target workflows' drafts AND redeploys them. The promote
      // result doesn't expose the affected ids, so invalidate all deployment caches:
      // otherwise a target workflow whose deployed state was already cached compares its
      // fresh draft against the stale (pre-sync) deployed snapshot and falsely shows
      // "Update" instead of "Live".
      queryClient.invalidateQueries({ queryKey: deploymentKeys.all })
    },
  })
}

export function useRollbackFork() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { workspaceId: string; body: RollbackForkBody }) =>
      requestJson(rollbackForkContract, { params: { id: vars.workspaceId }, body: vars.body }),
    onSettled: () => {
      // Rollback changes lineage, mappings, and the diff - not the copyable resource
      // inventory, so leave `resources` cached (mirrors usePromoteFork).
      queryClient.invalidateQueries({ queryKey: forkKeys.lineages() })
      queryClient.invalidateQueries({ queryKey: forkKeys.mappings() })
      queryClient.invalidateQueries({ queryKey: forkKeys.diffs() })
      queryClient.invalidateQueries({ queryKey: backgroundWorkKeys.lists() })
      // Rollback restores the target workflows' drafts + reactivates a prior deployment,
      // so the cached deployed snapshots are stale - refresh them so change detection
      // doesn't falsely show "Update" (mirrors usePromoteFork).
      queryClient.invalidateQueries({ queryKey: deploymentKeys.all })
    },
  })
}
