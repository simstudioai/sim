'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type FileWorkflowSnapshot,
  getHtmlRuntimeContract,
  readFileWorkflowContract,
  readPublicFileWorkflowContract,
  runFileWorkflowContract,
  runPublicFileWorkflowContract,
} from '@/lib/api/contracts/file-workflows'
import { getPublicFileContract } from '@/lib/api/contracts/public-shares'

export const FILE_WORKFLOW_STALE_TIME = 5_000
export const HTML_RUNTIME_STALE_TIME = 60_000
export type FileWorkflowTarget =
  | { kind: 'private'; workspaceId: string; fileId: string }
  | { kind: 'public'; token: string }
export const fileWorkflowKeys = {
  all: ['file-workflows'] as const,
  lists: () => ['file-workflows', 'list'] as const,
  list: (target: FileWorkflowTarget, workflowIds: readonly string[]) =>
    [...fileWorkflowKeys.lists(), target, workflowIds] as const,
  metadata: (token: string) => ['file-workflows', 'metadata', token] as const,
  runtime: () => ['file-workflows', 'runtime'] as const,
}

async function accessWorkflow(
  target: FileWorkflowTarget,
  workflowId: string,
  method: 'run' | 'read',
  signal?: AbortSignal
): Promise<FileWorkflowSnapshot> {
  if (target.kind === 'public') {
    const params = { token: target.token, workflowId }
    return method === 'run'
      ? requestJson(runPublicFileWorkflowContract, { params, body: {}, signal })
      : requestJson(readPublicFileWorkflowContract, { params, signal })
  }
  const params = { id: target.workspaceId, fileId: target.fileId, workflowId }
  return method === 'run'
    ? requestJson(runFileWorkflowContract, { params, body: {}, signal })
    : requestJson(readFileWorkflowContract, { params, signal })
}

export function useHtmlRuntime() {
  return useQuery({
    queryKey: fileWorkflowKeys.runtime(),
    queryFn: ({ signal }) => requestJson(getHtmlRuntimeContract, { signal }),
    staleTime: HTML_RUNTIME_STALE_TIME,
    retry: false,
  })
}

export function useFileWorkflowResults(target: FileWorkflowTarget, workflowIds: readonly string[]) {
  return useQuery({
    queryKey: fileWorkflowKeys.list(target, workflowIds),
    queryFn: async ({ signal }) => {
      const values = await Promise.all(
        workflowIds.map(async (workflowId) => ({
          workflowId,
          result: await accessWorkflow(target, workflowId, 'read', signal),
        }))
      )
      return values
    },
    staleTime: FILE_WORKFLOW_STALE_TIME,
    refetchInterval: 10_000,
    enabled: workflowIds.length > 0,
    retry: false,
  })
}

export function useFileWorkflowRequest(target: FileWorkflowTarget) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ method, workflowId }: { method: 'run' | 'read'; workflowId: string }) =>
      accessWorkflow(target, workflowId, method),
    onSettled: () => client.invalidateQueries({ queryKey: fileWorkflowKeys.lists() }),
  })
}

export function useWorkflowHtmlPublicMetadata(token: string, enabled: boolean) {
  return useQuery({
    queryKey: fileWorkflowKeys.metadata(token),
    queryFn: ({ signal }) => requestJson(getPublicFileContract, { params: { token }, signal }),
    staleTime: FILE_WORKFLOW_STALE_TIME,
    refetchInterval: 10_000,
    enabled,
    retry: false,
  })
}
