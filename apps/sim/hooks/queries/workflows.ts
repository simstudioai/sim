import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import {
  createOptimisticMutationHandlers,
  generateTempId,
} from '@/hooks/queries/utils/optimistic-mutation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import {
  generateCreativeWorkflowName,
  getNextWorkflowColor,
} from '@/stores/workflows/registry/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowQueries')

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...workflowKeys.lists(), workspaceId ?? ''] as const,
  deploymentVersions: () => [...workflowKeys.all, 'deploymentVersion'] as const,
  deploymentVersion: (workflowId: string | undefined, version: number | undefined) =>
    [...workflowKeys.deploymentVersions(), workflowId ?? '', version ?? 0] as const,
}

function mapWorkflow(workflow: any): WorkflowMetadata {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    color: workflow.color,
    workspaceId: workflow.workspaceId,
    folderId: workflow.folderId,
    createdAt: new Date(workflow.createdAt),
    lastModified: new Date(workflow.updatedAt || workflow.createdAt),
  }
}

async function fetchWorkflows(workspaceId: string): Promise<WorkflowMetadata[]> {
  const response = await fetch(`/api/workflows?workspaceId=${workspaceId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }

  const { data }: { data: any[] } = await response.json()
  return data.map(mapWorkflow)
}

export function useWorkflows(workspaceId?: string, options?: { syncRegistry?: boolean }) {
  const { syncRegistry = true } = options || {}
  const beginMetadataLoad = useWorkflowRegistry((state) => state.beginMetadataLoad)
  const completeMetadataLoad = useWorkflowRegistry((state) => state.completeMetadataLoad)
  const failMetadataLoad = useWorkflowRegistry((state) => state.failMetadataLoad)

  const query = useQuery({
    queryKey: workflowKeys.list(workspaceId),
    queryFn: () => fetchWorkflows(workspaceId as string),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'pending') {
      beginMetadataLoad(workspaceId)
    }
  }, [syncRegistry, workspaceId, query.status, beginMetadataLoad])

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'success' && query.data) {
      completeMetadataLoad(workspaceId, query.data)
    }
  }, [syncRegistry, workspaceId, query.status, query.data, completeMetadataLoad])

  useEffect(() => {
    if (syncRegistry && workspaceId && query.status === 'error') {
      const message =
        query.error instanceof Error ? query.error.message : 'Failed to fetch workflows'
      failMetadataLoad(workspaceId, message)
    }
  }, [syncRegistry, workspaceId, query.status, query.error, failMetadataLoad])

  return query
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  color?: string
  folderId?: string | null
}

interface CreateWorkflowResult {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
}

interface DuplicateWorkflowVariables {
  workspaceId: string
  sourceId: string
  name: string
  description?: string
  color: string
  folderId?: string | null
}

interface DuplicateWorkflowResult {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
  blocksCount: number
  edgesCount: number
  subflowsCount: number
}

/**
 * Creates optimistic mutation handlers for workflow operations
 */
function createWorkflowMutationHandlers<TVariables extends { workspaceId: string }>(
  queryClient: ReturnType<typeof useQueryClient>,
  name: string,
  createOptimisticWorkflow: (variables: TVariables, tempId: string) => WorkflowMetadata
) {
  return createOptimisticMutationHandlers<
    CreateWorkflowResult | DuplicateWorkflowResult,
    TVariables,
    WorkflowMetadata
  >(queryClient, {
    name,
    getQueryKey: (variables) => workflowKeys.list(variables.workspaceId),
    getSnapshot: () => ({ ...useWorkflowRegistry.getState().workflows }),
    generateTempId: () => generateTempId('temp-workflow'),
    createOptimisticItem: createOptimisticWorkflow,
    applyOptimisticUpdate: (tempId, item) => {
      useWorkflowRegistry.setState((state) => ({
        workflows: { ...state.workflows, [tempId]: item },
      }))
    },
    replaceOptimisticEntry: (tempId, data) => {
      useWorkflowRegistry.setState((state) => {
        const { [tempId]: _, ...remainingWorkflows } = state.workflows
        return {
          workflows: {
            ...remainingWorkflows,
            [data.id]: {
              id: data.id,
              name: data.name,
              lastModified: new Date(),
              createdAt: new Date(),
              description: data.description,
              color: data.color,
              workspaceId: data.workspaceId,
              folderId: data.folderId,
            },
          },
          error: null,
        }
      })
    },
    rollback: (snapshot) => {
      useWorkflowRegistry.setState({ workflows: snapshot })
    },
  })
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  const handlers = createWorkflowMutationHandlers<CreateWorkflowVariables>(
    queryClient,
    'CreateWorkflow',
    (variables, tempId) => ({
      id: tempId,
      name: variables.name || generateCreativeWorkflowName(),
      lastModified: new Date(),
      createdAt: new Date(),
      description: variables.description || 'New workflow',
      color: variables.color || getNextWorkflowColor(),
      workspaceId: variables.workspaceId,
      folderId: variables.folderId || null,
    })
  )

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables): Promise<CreateWorkflowResult> => {
      const { workspaceId, name, description, color, folderId } = variables

      logger.info(`Creating new workflow in workspace: ${workspaceId}`)

      const createResponse = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || generateCreativeWorkflowName(),
          description: description || 'New workflow',
          color: color || getNextWorkflowColor(),
          workspaceId,
          folderId: folderId || null,
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(
          `Failed to create workflow: ${errorData.error || createResponse.statusText}`
        )
      }

      const createdWorkflow = await createResponse.json()
      const workflowId = createdWorkflow.id

      logger.info(`Successfully created workflow ${workflowId}`)

      const { workflowState } = buildDefaultWorkflowArtifacts()

      const stateResponse = await fetch(`/api/workflows/${workflowId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowState),
      })

      if (!stateResponse.ok) {
        const text = await stateResponse.text()
        logger.error('Failed to persist default Start block:', text)
      } else {
        logger.info('Successfully persisted default Start block')
      }

      return {
        id: workflowId,
        name: createdWorkflow.name,
        description: createdWorkflow.description,
        color: createdWorkflow.color,
        workspaceId,
        folderId: createdWorkflow.folderId,
      }
    },
    ...handlers,
    onSuccess: (data, variables, context) => {
      handlers.onSuccess(data, variables, context)

      // Initialize subblock values for new workflow
      const { subBlockValues } = buildDefaultWorkflowArtifacts()
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [data.id]: subBlockValues,
        },
      }))
    },
  })
}

export function useDuplicateWorkflowMutation() {
  const queryClient = useQueryClient()

  const handlers = createWorkflowMutationHandlers<DuplicateWorkflowVariables>(
    queryClient,
    'DuplicateWorkflow',
    (variables, tempId) => ({
      id: tempId,
      name: variables.name,
      lastModified: new Date(),
      createdAt: new Date(),
      description: variables.description,
      color: variables.color,
      workspaceId: variables.workspaceId,
      folderId: variables.folderId || null,
    })
  )

  return useMutation({
    mutationFn: async (variables: DuplicateWorkflowVariables): Promise<DuplicateWorkflowResult> => {
      const { workspaceId, sourceId, name, description, color, folderId } = variables

      logger.info(`Duplicating workflow ${sourceId} in workspace: ${workspaceId}`)

      const response = await fetch(`/api/workflows/${sourceId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          color,
          workspaceId,
          folderId: folderId ?? null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`Failed to duplicate workflow: ${errorData.error || response.statusText}`)
      }

      const duplicatedWorkflow = await response.json()

      logger.info(`Successfully duplicated workflow ${sourceId} to ${duplicatedWorkflow.id}`, {
        blocksCount: duplicatedWorkflow.blocksCount,
        edgesCount: duplicatedWorkflow.edgesCount,
        subflowsCount: duplicatedWorkflow.subflowsCount,
      })

      return {
        id: duplicatedWorkflow.id,
        name: duplicatedWorkflow.name || name,
        description: duplicatedWorkflow.description || description,
        color: duplicatedWorkflow.color || color,
        workspaceId,
        folderId: duplicatedWorkflow.folderId ?? folderId,
        blocksCount: duplicatedWorkflow.blocksCount || 0,
        edgesCount: duplicatedWorkflow.edgesCount || 0,
        subflowsCount: duplicatedWorkflow.subflowsCount || 0,
      }
    },
    ...handlers,
    onSuccess: (data, variables, context) => {
      handlers.onSuccess(data, variables, context)

      // Copy subblock values from source if it's the active workflow
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (variables.sourceId === activeWorkflowId) {
        const sourceSubblockValues =
          useSubBlockStore.getState().workflowValues[variables.sourceId] || {}
        useSubBlockStore.setState((state) => ({
          workflowValues: {
            ...state.workflowValues,
            [data.id]: { ...sourceSubblockValues },
          },
        }))
      }
    },
  })
}

interface DeploymentVersionStateResponse {
  deployedState: WorkflowState
}

async function fetchDeploymentVersionState(
  workflowId: string,
  version: number
): Promise<WorkflowState> {
  const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch deployment version: ${response.statusText}`)
  }

  const data: DeploymentVersionStateResponse = await response.json()
  if (!data.deployedState) {
    throw new Error('No deployed state returned')
  }

  return data.deployedState
}

/**
 * Hook for fetching the workflow state of a specific deployment version.
 * Used in the deploy modal to preview historical versions.
 */
export function useDeploymentVersionState(workflowId: string | null, version: number | null) {
  return useQuery({
    queryKey: workflowKeys.deploymentVersion(workflowId ?? undefined, version ?? undefined),
    queryFn: () => fetchDeploymentVersionState(workflowId as string, version as number),
    enabled: Boolean(workflowId) && version !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes - deployment versions don't change
  })
}

interface RevertToVersionVariables {
  workflowId: string
  version: number
}

/**
 * Mutation hook for reverting (loading) a deployment version into the current workflow.
 */
export function useRevertToVersion() {
  return useMutation({
    mutationFn: async ({ workflowId, version }: RevertToVersionVariables): Promise<void> => {
      const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}/revert`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to load deployment')
      }
    },
  })
}
