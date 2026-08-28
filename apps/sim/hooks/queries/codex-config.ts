import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowCodexConfigContract,
  getWorkspaceCodexConfigContract,
  updateWorkflowCodexConfigContract,
  updateWorkspaceCodexConfigContract,
} from '@/lib/api/contracts/codex-config'
import type { CodexConfigPatch, CodexWorkflowConfig } from '@/lib/codex/config'

export const codexConfigKeys = {
  all: ['codex-config'] as const,
  workspace: (workspaceId: string) => [...codexConfigKeys.all, 'workspace', workspaceId] as const,
  workflow: (workflowId: string) => [...codexConfigKeys.all, 'workflow', workflowId] as const,
}

export function useWorkspaceCodexConfig(workspaceId: string | undefined) {
  return useQuery({
    queryKey: codexConfigKeys.workspace(workspaceId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(getWorkspaceCodexConfigContract, {
        params: { id: workspaceId ?? '' },
        signal,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  })
}

export function useWorkflowCodexConfig(workflowId: string | undefined) {
  return useQuery({
    queryKey: codexConfigKeys.workflow(workflowId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(getWorkflowCodexConfigContract, {
        params: { id: workflowId ?? '' },
        signal,
      }),
    enabled: Boolean(workflowId),
    staleTime: 30_000,
  })
}

export function useUpdateWorkspaceCodexConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, config }: { workspaceId: string; config: CodexConfigPatch }) =>
      requestJson(updateWorkspaceCodexConfigContract, {
        params: { id: workspaceId },
        body: { config },
      }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(codexConfigKeys.workspace(variables.workspaceId), data)
    },
  })
}

export function useUpdateWorkflowCodexConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workflowId, config }: { workflowId: string; config: CodexWorkflowConfig }) =>
      requestJson(updateWorkflowCodexConfigContract, {
        params: { id: workflowId },
        body: { config },
      }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(codexConfigKeys.workflow(variables.workflowId), data)
    },
  })
}
