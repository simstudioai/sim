import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { deploymentKeys } from '@/hooks/queries/deployments'
import {
  createOptimisticMutationHandlers,
  generateTempId,
} from '@/hooks/queries/utils/optimistic-mutation'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowQueries')

type WorkflowQueryScope = 'active' | 'archived' | 'all'

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, scope: WorkflowQueryScope = 'active') =>
    [...workflowKeys.lists(), workspaceId ?? '', scope] as const,
  deploymentVersions: () => [...workflowKeys.all, 'deploymentVersion'] as const,
  deploymentVersion: (workflowId: string | undefined, version: number | undefined) =>
    [...workflowKeys.deploymentVersions(), workflowId ?? '', version ?? 0] as const,
  state: (workflowId: string | undefined) =>
    [...workflowKeys.all, 'state', workflowId ?? ''] as const,
}

/**
 * Fetches workflow state from the API.
 * Used as the base query for both state preview and input fields extraction.
 */
async function fetchWorkflowState(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowState | null> {
  const response = await fetch(`/api/workflows/${workflowId}`, { signal })
  if (!response.ok) throw new Error('Failed to fetch workflow')
  const { data } = await response.json()
  return data?.state ?? null
}

/**
 * Hook to fetch workflow state.
 * Used by workflow blocks to show a preview of the child workflow
 * and as a base query for input fields extraction.
 *
 * @param workflowId - The workflow ID to fetch state for
 * @returns Query result with workflow state
 */
export function useWorkflowState(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.state(workflowId),
    queryFn: ({ signal }) => fetchWorkflowState(workflowId!, signal),
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000, // 30 seconds
  })
}

function mapWorkflow(workflow: any): WorkflowMetadata {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    color: workflow.color,
    workspaceId: workflow.workspaceId,
    folderId: workflow.folderId,
    sortOrder: workflow.sortOrder ?? 0,
    createdAt: new Date(workflow.createdAt),
    lastModified: new Date(workflow.updatedAt || workflow.createdAt),
    archivedAt: workflow.archivedAt ? new Date(workflow.archivedAt) : null,
  }
}

async function fetchWorkflows(
  workspaceId: string,
  scope: WorkflowQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkflowMetadata[]> {
  const response = await fetch(`/api/workflows?workspaceId=${workspaceId}&scope=${scope}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error('Failed to fetch workflows')
  }

  const { data }: { data: any[] } = await response.json()
  return data.map(mapWorkflow)
}

export function useWorkflows(
  workspaceId?: string,
  options?: { syncRegistry?: boolean; scope?: WorkflowQueryScope }
) {
  const { syncRegistry = true, scope = 'active' } = options || {}
  const beginMetadataLoad = useWorkflowRegistry((state) => state.beginMetadataLoad)
  const completeMetadataLoad = useWorkflowRegistry((state) => state.completeMetadataLoad)
  const failMetadataLoad = useWorkflowRegistry((state) => state.failMetadataLoad)

  const query = useQuery({
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchWorkflows(workspaceId as string, scope, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (
      syncRegistry &&
      scope === 'active' &&
      workspaceId &&
      (query.status === 'pending' || query.isPlaceholderData)
    ) {
      beginMetadataLoad(workspaceId)
    }
  }, [syncRegistry, scope, workspaceId, query.status, query.isPlaceholderData, beginMetadataLoad])

  useEffect(() => {
    if (
      syncRegistry &&
      scope === 'active' &&
      workspaceId &&
      query.status === 'success' &&
      query.data &&
      !query.isPlaceholderData
    ) {
      completeMetadataLoad(workspaceId, query.data)
    }
  }, [
    syncRegistry,
    scope,
    workspaceId,
    query.status,
    query.data,
    query.isPlaceholderData,
    completeMetadataLoad,
  ])

  useEffect(() => {
    if (syncRegistry && scope === 'active' && workspaceId && query.status === 'error') {
      const message =
        query.error instanceof Error ? query.error.message : 'Failed to fetch workflows'
      failMetadataLoad(workspaceId, message)
    }
  }, [syncRegistry, scope, workspaceId, query.status, query.error, failMetadataLoad])

  return query
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  sortOrder?: number
  id?: string
}

interface CreateWorkflowResult {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
  sortOrder: number
}

interface DuplicateWorkflowVariables {
  workspaceId: string
  sourceId: string
  name: string
  description?: string
  color: string
  folderId?: string | null
  newId?: string
}

interface DuplicateWorkflowResult {
  id: string
  name: string
  description?: string
  color: string
  workspaceId: string
  folderId?: string | null
  sortOrder: number
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
  createOptimisticWorkflow: (variables: TVariables, tempId: string) => WorkflowMetadata,
  customGenerateTempId?: (variables: TVariables) => string
) {
  return createOptimisticMutationHandlers<
    CreateWorkflowResult | DuplicateWorkflowResult,
    TVariables,
    WorkflowMetadata
  >(queryClient, {
    name,
    getQueryKey: (variables) => workflowKeys.list(variables.workspaceId, 'active'),
    getSnapshot: () => ({ ...useWorkflowRegistry.getState().workflows }),
    generateTempId: customGenerateTempId ?? (() => generateTempId('temp-workflow')),
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
              sortOrder: 'sortOrder' in data ? data.sortOrder : 0,
            },
          },
          error: null,
        }
      })

      if (tempId !== data.id) {
        useFolderStore.setState((state) => {
          const selectedWorkflows = new Set(state.selectedWorkflows)
          if (selectedWorkflows.has(tempId)) {
            selectedWorkflows.delete(tempId)
            selectedWorkflows.add(data.id)
          }
          return { selectedWorkflows }
        })
      }
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
    (variables, tempId) => {
      let sortOrder: number
      if (variables.sortOrder !== undefined) {
        sortOrder = variables.sortOrder
      } else {
        const currentWorkflows = useWorkflowRegistry.getState().workflows
        const currentFolders = useFolderStore.getState().folders
        sortOrder = getTopInsertionSortOrder(
          currentWorkflows,
          currentFolders,
          variables.workspaceId,
          variables.folderId
        )
      }

      return {
        id: tempId,
        name: variables.name || generateCreativeWorkflowName(),
        lastModified: new Date(),
        createdAt: new Date(),
        description: variables.description || 'New workflow',
        color: variables.color || getNextWorkflowColor(),
        workspaceId: variables.workspaceId,
        folderId: variables.folderId || null,
        sortOrder,
      }
    },
    (variables) => variables.id ?? crypto.randomUUID()
  )

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables): Promise<CreateWorkflowResult> => {
      const { workspaceId, name, description, color, folderId, sortOrder, id } = variables

      logger.info(`Creating new workflow in workspace: ${workspaceId}`)

      const createResponse = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: name || generateCreativeWorkflowName(),
          description: description || 'New workflow',
          color: color || getNextWorkflowColor(),
          workspaceId,
          folderId: folderId || null,
          sortOrder,
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
        sortOrder: createdWorkflow.sortOrder ?? 0,
      }
    },
    ...handlers,
    onSuccess: (data, variables, context) => {
      handlers.onSuccess(data, variables, context)

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
    (variables, tempId) => {
      const currentWorkflows = useWorkflowRegistry.getState().workflows
      const currentFolders = useFolderStore.getState().folders
      const targetFolderId = variables.folderId ?? null

      return {
        id: tempId,
        name: variables.name,
        lastModified: new Date(),
        createdAt: new Date(),
        description: variables.description,
        color: variables.color,
        workspaceId: variables.workspaceId,
        folderId: targetFolderId,
        sortOrder: getTopInsertionSortOrder(
          currentWorkflows,
          currentFolders,
          variables.workspaceId,
          targetFolderId
        ),
      }
    },
    (variables) => variables.newId ?? crypto.randomUUID()
  )

  return useMutation({
    mutationFn: async (variables: DuplicateWorkflowVariables): Promise<DuplicateWorkflowResult> => {
      const { workspaceId, sourceId, name, description, color, folderId, newId } = variables

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
          newId,
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
        sortOrder: duplicatedWorkflow.sortOrder ?? 0,
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

/**
 * Fetches the deployed state for a specific deployment version.
 * Exported for reuse in other query hooks.
 */
export async function fetchDeploymentVersionState(
  workflowId: string,
  version: number,
  signal?: AbortSignal
): Promise<WorkflowState> {
  const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}`, { signal })

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
    queryFn: ({ signal }) =>
      fetchDeploymentVersionState(workflowId as string, version as number, signal),
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
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId, version }: RevertToVersionVariables): Promise<void> => {
      const response = await fetch(`/api/workflows/${workflowId}/deployments/${version}/revert`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to load deployment')
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workflowKeys.state(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.info(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.deployedState(variables.workflowId),
      })
      queryClient.invalidateQueries({
        queryKey: deploymentKeys.versions(variables.workflowId),
      })
    },
  })
}

interface ReorderWorkflowsVariables {
  workspaceId: string
  updates: Array<{
    id: string
    sortOrder: number
    folderId?: string | null
  }>
}

export function useReorderWorkflows() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: ReorderWorkflowsVariables): Promise<void> => {
      const response = await fetch('/api/workflows/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to reorder workflows')
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: workflowKeys.lists() })

      const snapshot = { ...useWorkflowRegistry.getState().workflows }

      useWorkflowRegistry.setState((state) => {
        const updated = { ...state.workflows }
        for (const update of variables.updates) {
          if (updated[update.id]) {
            updated[update.id] = {
              ...updated[update.id],
              sortOrder: update.sortOrder,
              folderId:
                update.folderId !== undefined ? update.folderId : updated[update.id].folderId,
            }
          }
        }
        return { workflows: updated }
      })

      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        useWorkflowRegistry.setState({ workflows: context.snapshot })
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() })
    },
  })
}

/**
 * Import workflow mutation (superuser debug)
 */
interface ImportWorkflowParams {
  workflowId: string
  targetWorkspaceId: string
}

interface ImportWorkflowResponse {
  newWorkflowId: string
  copilotChatsImported?: number
}

export function useImportWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      targetWorkspaceId,
    }: ImportWorkflowParams): Promise<ImportWorkflowResponse> => {
      const response = await fetch('/api/superuser/import-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, targetWorkspaceId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error || `Import failed with status ${response.status}`)
      }

      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() })
    },
  })
}

export function useRestoreWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workflowId: string) => {
      const res = await fetch(`/api/workflows/${workflowId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore workflow')
      }
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() })
    },
  })
}
