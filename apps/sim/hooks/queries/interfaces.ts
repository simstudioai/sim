import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createInterfaceContract,
  deleteInterfaceContract,
  generateInterfaceContract,
  getInterfaceDeploymentStatusContract,
  updateInterfaceContract,
  validateInterfaceIdentifierContract,
} from '@/lib/api/contracts/interfaces'
import { invalidateDeploymentQueries } from '@/hooks/queries/deployments'

const logger = createLogger('InterfaceMutations')

export const interfaceKeys = {
  all: ['interfaces'] as const,
  statuses: () => [...interfaceKeys.all, 'status'] as const,
  status: (workflowId: string | null) => [...interfaceKeys.statuses(), workflowId ?? ''] as const,
}

async function fetchInterfaceDeploymentStatus(workflowId: string, signal?: AbortSignal) {
  return requestJson(getInterfaceDeploymentStatusContract, {
    params: { id: workflowId },
    signal,
  })
}

export function useInterfaceDeploymentInfo(
  workflowId: string | null,
  options?: { enabled?: boolean }
) {
  const query = useQuery({
    queryKey: interfaceKeys.status(workflowId),
    queryFn: ({ signal }) => fetchInterfaceDeploymentStatus(workflowId!, signal),
    enabled: Boolean(workflowId) && (options?.enabled ?? true),
    staleTime: 30_000,
  })

  return {
    isLoading: query.isLoading,
    interfaceExists: query.data?.isDeployed ?? false,
    existingInterface: query.data?.deployment ?? null,
    refetch: query.refetch,
  }
}

export function useGenerateInterface() {
  return useMutation({
    mutationFn: (body: {
      workflowId: string
      brief?: string
      primaryColor?: string
      title?: string
    }) => requestJson(generateInterfaceContract, { body }),
  })
}

export function useCreateInterface() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      workflowId: string
      identifier: string
      title: string
      description?: string
      customizations?: { primaryColor?: string; brief?: string }
      outputConfigs?: Array<{ blockId: string; path: string }>
      spec: unknown
    }) => requestJson(createInterfaceContract, { body }),
    onSuccess: async (_data, variables) => {
      await invalidateDeploymentQueries(queryClient, variables.workflowId)
      await queryClient.invalidateQueries({
        queryKey: interfaceKeys.status(variables.workflowId),
      })
    },
    onError: (error) => {
      logger.error('Failed to create interface', error)
    },
  })
}

export function useUpdateInterface() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      id: string
      workflowId: string
      body: {
        identifier?: string
        title?: string
        description?: string
        customizations?: { primaryColor?: string; brief?: string }
        outputConfigs?: Array<{ blockId: string; path: string }>
        spec?: unknown
      }
    }) =>
      requestJson(updateInterfaceContract, {
        params: { id: vars.id },
        body: vars.body,
      }),
    onSuccess: async (_data, variables) => {
      await invalidateDeploymentQueries(queryClient, variables.workflowId)
      await queryClient.invalidateQueries({
        queryKey: interfaceKeys.status(variables.workflowId),
      })
    },
  })
}

export function useDeleteInterface() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; workflowId: string }) =>
      requestJson(deleteInterfaceContract, { params: { id: vars.id } }),
    onSuccess: async (_data, variables) => {
      await invalidateDeploymentQueries(queryClient, variables.workflowId)
      await queryClient.invalidateQueries({
        queryKey: interfaceKeys.status(variables.workflowId),
      })
    },
  })
}

export async function validateInterfaceIdentifier(identifier: string): Promise<{
  available: boolean
  error?: string | null
}> {
  return requestJson(validateInterfaceIdentifierContract, {
    query: { identifier },
  })
}
