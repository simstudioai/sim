/**
 * React Query hooks for managing workflow metadata and mutations.
 */

import { createLogger } from '@sim/logger'
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { fetchDeploymentVersionState } from '@/hooks/queries/utils/fetch-deployment-version-state'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import {
  getWorkflowListQueryOptions,
  mapWorkflow,
  WORKFLOW_LIST_STALE_TIME,
} from '@/hooks/queries/utils/workflow-list-query'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowQueries')

export { type WorkflowQueryScope, workflowKeys } from '@/hooks/queries/utils/workflow-keys'

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
 * Fetches the full workflow state for a single workflow.
 * Used by workflow blocks to show a preview of the child workflow
 * and as a base query for input fields extraction.
 */
export function useWorkflowState(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.state(workflowId),
    queryFn: workflowId ? ({ signal }) => fetchWorkflowState(workflowId, signal) : skipToken,
    staleTime: 30 * 1000,
  })
}

export function useWorkflows(workspaceId?: string, options?: { scope?: WorkflowQueryScope }) {
  const { scope = 'active' } = options || {}

  return useQuery({
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn: workspaceId ? getWorkflowListQueryOptions(workspaceId, scope).queryFn : skipToken,
    placeholderData: keepPreviousData,
    staleTime: WORKFLOW_LIST_STALE_TIME,
  })
}

/**
 * Returns workflows as a `Record<string, WorkflowMetadata>` keyed by ID.
 * Uses the `select` option so the transformation runs inside React Query
 * with structural sharing — components only re-render when the record changes.
 */
export function useWorkflowMap(workspaceId?: string, options?: { scope?: WorkflowQueryScope }) {
  const { scope = 'active' } = options || {}

  return useQuery({
    queryKey: workflowKeys.list(workspaceId, scope),
    queryFn: workspaceId ? getWorkflowListQueryOptions(workspaceId, scope).queryFn : skipToken,
    placeholderData: keepPreviousData,
    staleTime: WORKFLOW_LIST_STALE_TIME,
    select: (data) => Object.fromEntries(data.map((w) => [w.id, w])),
  })
}

interface CreateWorkflowVariables {
  workspaceId: string
  name?: string
  description?: string
  color?: string
  folderId?: string | null
  sortOrder?: number
  id?: string
  deduplicate?: boolean
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

export function useCreateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: CreateWorkflowVariables): Promise<CreateWorkflowResult> => {
      const { workspaceId, name, description, color, folderId, sortOrder, id, deduplicate } =
        variables

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
          deduplicate,
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
        logger.error('Failed to persist default workflow state:', text)
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
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      const tempId = variables.id ?? crypto.randomUUID()
      let sortOrder: number
      if (variables.sortOrder !== undefined) {
        sortOrder = variables.sortOrder
      } else {
        const currentWorkflows = Object.fromEntries(
          getWorkflows(variables.workspaceId).map((w) => [w.id, w])
        )
        sortOrder = getTopInsertionSortOrder(
          currentWorkflows,
          getFolderMap(variables.workspaceId),
          variables.workspaceId,
          variables.folderId
        )
      }

      const optimistic: WorkflowMetadata = {
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

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => [...(old ?? []), optimistic]
      )
      logger.info(`[CreateWorkflow] Added optimistic entry: ${tempId}`)

      return { snapshot, tempId }
    },
    onSuccess: (data, variables, context) => {
      if (!context) return
      const { tempId } = context

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === tempId
              ? {
                  id: data.id,
                  name: data.name,
                  lastModified: new Date(),
                  createdAt: new Date(),
                  description: data.description,
                  color: data.color,
                  workspaceId: data.workspaceId,
                  folderId: data.folderId,
                  sortOrder: data.sortOrder,
                }
              : w
          )
      )

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

      const { subBlockValues } = buildDefaultWorkflowArtifacts()
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [data.id]: subBlockValues,
        },
      }))

      logger.info(`[CreateWorkflow] Success, replaced temp entry ${tempId}`)
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
        logger.info('[CreateWorkflow] Rolled back to previous state')
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
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

export function useDuplicateWorkflowMutation() {
  const queryClient = useQueryClient()

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
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )
      const tempId = variables.newId ?? crypto.randomUUID()

      const currentWorkflows = Object.fromEntries(
        getWorkflows(variables.workspaceId).map((w) => [w.id, w])
      )
      const targetFolderId = variables.folderId ?? null

      const optimistic: WorkflowMetadata = {
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
          getFolderMap(variables.workspaceId),
          variables.workspaceId,
          targetFolderId
        ),
      }

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => [...(old ?? []), optimistic]
      )
      logger.info(`[DuplicateWorkflow] Added optimistic entry: ${tempId}`)

      return { snapshot, tempId }
    },
    onSuccess: (data, variables, context) => {
      if (!context) return
      const { tempId } = context

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === tempId
              ? {
                  id: data.id,
                  name: data.name,
                  lastModified: new Date(),
                  createdAt: new Date(),
                  description: data.description,
                  color: data.color,
                  workspaceId: data.workspaceId,
                  folderId: data.folderId,
                  sortOrder: data.sortOrder,
                }
              : w
          )
      )

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

      logger.info(`[DuplicateWorkflow] Success, replaced temp entry ${tempId}`)
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
        logger.info('[DuplicateWorkflow] Rolled back to previous state')
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

interface UpdateWorkflowVariables {
  workspaceId: string
  workflowId: string
  metadata: Partial<WorkflowMetadata>
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: UpdateWorkflowVariables) => {
      const response = await fetch(`/api/workflows/${variables.workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables.metadata),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update workflow')
      }

      const { workflow: updatedWorkflow } = await response.json()
      return mapWorkflow(updatedWorkflow)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) =>
            w.id === variables.workflowId
              ? { ...w, ...variables.metadata, lastModified: new Date() }
              : w
          )
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

interface DeleteWorkflowVariables {
  workspaceId: string
  workflowId: string
}

export function useDeleteWorkflowMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: DeleteWorkflowVariables) => {
      const response = await fetch(`/api/workflows/${variables.workflowId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || 'Failed to delete workflow')
      }

      logger.info(`Successfully deleted workflow ${variables.workflowId} from database`)
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) => (old ?? []).filter((w) => w.id !== variables.workflowId)
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}

export function useDeploymentVersionState(workflowId: string | null, version: number | null) {
  return useQuery({
    queryKey: workflowKeys.deploymentVersion(workflowId ?? undefined, version ?? undefined),
    queryFn:
      workflowId && version !== null
        ? ({ signal }) => fetchDeploymentVersionState(workflowId, version, signal)
        : skipToken,
    staleTime: 5 * 60 * 1000,
  })
}

interface RevertToVersionVariables {
  workflowId: string
  version: number
}

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
    onSettled: (_data, _error, variables) => {
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
      await queryClient.cancelQueries({
        queryKey: workflowKeys.list(variables.workspaceId, 'active'),
      })

      const snapshot = queryClient.getQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active')
      )

      const updateMap = new Map(variables.updates.map((u) => [u.id, u]))
      queryClient.setQueryData<WorkflowMetadata[]>(
        workflowKeys.list(variables.workspaceId, 'active'),
        (old) =>
          (old ?? []).map((w) => {
            const update = updateMap.get(w.id)
            if (!update) return w
            return {
              ...w,
              sortOrder: update.sortOrder,
              folderId: update.folderId !== undefined ? update.folderId : w.folderId,
            }
          })
      )

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(
          workflowKeys.list(variables.workspaceId, 'active'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

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
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.targetWorkspaceId)
    },
  })
}

export function useRestoreWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workflowId }: { workflowId: string; workspaceId: string }) => {
      const res = await fetch(`/api/workflows/${workflowId}/restore`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore workflow')
      }
      return res.json()
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}
