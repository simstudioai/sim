import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { withOptimisticUpdate } from '@/lib/core/utils/optimistic-update'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type {
  DeploymentStatus,
  HydrationState,
  WorkflowMetadata,
  WorkflowRegistry,
} from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, regenerateBlockIds } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowRegistry')
const initialHydration: HydrationState = {
  phase: 'idle',
  workspaceId: null,
  workflowId: null,
  requestId: null,
  error: null,
}

const createRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

// Track workspace transitions to prevent race conditions
let isWorkspaceTransitioning = false
const TRANSITION_TIMEOUT = 5000 // 5 seconds maximum for workspace transitions

// Resets workflow and subblock stores to prevent data leakage between workspaces
function resetWorkflowStores() {
  // Reset the workflow store to prevent data leakage between workspaces
  useWorkflowStore.setState({
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    deploymentStatuses: {},
    lastSaved: Date.now(),
  })

  // Reset the subblock store
  useSubBlockStore.setState({
    workflowValues: {},
  })
}

/**
 * Handles workspace transition state tracking
 * @param isTransitioning Whether workspace is currently transitioning
 */
function setWorkspaceTransitioning(isTransitioning: boolean): void {
  isWorkspaceTransitioning = isTransitioning

  if (isTransitioning) {
    setTimeout(() => {
      if (isWorkspaceTransitioning) {
        logger.warn('Forcing workspace transition to complete due to timeout')
        isWorkspaceTransitioning = false
      }
    }, TRANSITION_TIMEOUT)
  }
}

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      workflows: {},
      activeWorkflowId: null,
      error: null,
      deploymentStatuses: {},
      hydration: initialHydration,
      clipboard: null,
      pendingSelection: null,

      beginMetadataLoad: (workspaceId: string) => {
        set((state) => ({
          error: null,
          hydration: {
            phase: 'metadata-loading',
            workspaceId,
            workflowId: null,
            requestId: null,
            error: null,
          },
        }))
      },

      completeMetadataLoad: (workspaceId: string, workflows: WorkflowMetadata[]) => {
        const mapped = workflows.reduce<Record<string, WorkflowMetadata>>((acc, workflow) => {
          acc[workflow.id] = workflow
          return acc
        }, {})

        set((state) => {
          const shouldPreserveHydration =
            state.hydration.phase === 'state-loading' ||
            (state.hydration.phase === 'ready' &&
              state.hydration.workflowId &&
              mapped[state.hydration.workflowId])

          return {
            workflows: mapped,
            error: null,
            hydration: shouldPreserveHydration
              ? state.hydration
              : {
                  phase: 'metadata-ready',
                  workspaceId,
                  workflowId: null,
                  requestId: null,
                  error: null,
                },
          }
        })
      },

      failMetadataLoad: (workspaceId: string | null, errorMessage: string) => {
        set((state) => ({
          error: errorMessage,
          hydration: {
            phase: 'error',
            workspaceId: workspaceId ?? state.hydration.workspaceId,
            workflowId: state.hydration.workflowId,
            requestId: null,
            error: errorMessage,
          },
        }))
      },

      switchToWorkspace: async (workspaceId: string) => {
        if (isWorkspaceTransitioning) {
          logger.warn(
            `Ignoring workspace switch to ${workspaceId} - transition already in progress`
          )
          return
        }

        setWorkspaceTransitioning(true)

        try {
          logger.info(`Switching to workspace: ${workspaceId}`)

          resetWorkflowStores()

          set({
            activeWorkflowId: null,
            workflows: {},
            deploymentStatuses: {},
            error: null,
            hydration: {
              phase: 'metadata-loading',
              workspaceId,
              workflowId: null,
              requestId: null,
              error: null,
            },
          })

          logger.info(`Successfully switched to workspace: ${workspaceId}`)
        } catch (error) {
          logger.error(`Error switching to workspace ${workspaceId}:`, { error })
          set({
            error: `Failed to switch workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
            hydration: {
              phase: 'error',
              workspaceId,
              workflowId: null,
              requestId: null,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          })
        } finally {
          setWorkspaceTransitioning(false)
        }
      },

      getWorkflowDeploymentStatus: (workflowId: string | null): DeploymentStatus | null => {
        if (!workflowId) {
          workflowId = get().activeWorkflowId
          if (!workflowId) return null
        }

        const { deploymentStatuses = {} } = get()

        if (deploymentStatuses[workflowId]) {
          return deploymentStatuses[workflowId]
        }

        return null
      },

      setDeploymentStatus: (
        workflowId: string | null,
        isDeployed: boolean,
        deployedAt?: Date,
        apiKey?: string
      ) => {
        if (!workflowId) {
          workflowId = get().activeWorkflowId
          if (!workflowId) return
        }

        set((state) => ({
          deploymentStatuses: {
            ...state.deploymentStatuses,
            [workflowId as string]: {
              isDeployed,
              deployedAt: deployedAt || (isDeployed ? new Date() : undefined),
              apiKey,
              needsRedeployment: isDeployed
                ? false
                : ((state.deploymentStatuses?.[workflowId as string] as any)?.needsRedeployment ??
                  false),
            },
          },
        }))
      },

      setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => {
        if (!workflowId) {
          workflowId = get().activeWorkflowId
          if (!workflowId) return
        }

        set((state) => {
          const deploymentStatuses = state.deploymentStatuses || {}
          const currentStatus = deploymentStatuses[workflowId as string] || { isDeployed: false }

          return {
            deploymentStatuses: {
              ...deploymentStatuses,
              [workflowId as string]: {
                ...currentStatus,
                needsRedeployment,
              },
            },
          }
        })

        const { activeWorkflowId } = get()
        if (workflowId === activeWorkflowId) {
          useWorkflowStore.getState().setNeedsRedeploymentFlag(needsRedeployment)
        }
      },

      loadWorkflowState: async (workflowId: string) => {
        const { workflows } = get()

        if (!workflows[workflowId]) {
          const message = `Workflow not found: ${workflowId}`
          logger.error(message)
          set({ error: message })
          throw new Error(message)
        }

        const requestId = createRequestId()

        set((state) => ({
          error: null,
          hydration: {
            phase: 'state-loading',
            workspaceId: state.hydration.workspaceId,
            workflowId,
            requestId,
            error: null,
          },
        }))

        try {
          const response = await fetch(`/api/workflows/${workflowId}`, { method: 'GET' })
          if (!response.ok) {
            throw new Error(`Failed to load workflow ${workflowId}`)
          }

          const workflowData = (await response.json()).data
          let workflowState: any

          if (workflowData?.state) {
            workflowState = {
              blocks: workflowData.state.blocks || {},
              edges: workflowData.state.edges || [],
              loops: workflowData.state.loops || {},
              parallels: workflowData.state.parallels || {},
              lastSaved: Date.now(),
              deploymentStatuses: {},
            }
          } else {
            workflowState = {
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
              deploymentStatuses: {},
              lastSaved: Date.now(),
            }

            logger.info(
              `Workflow ${workflowId} has no state yet - will load from DB or show empty canvas`
            )
          }

          const nextDeploymentStatuses =
            workflowData?.isDeployed || workflowData?.deployedAt
              ? {
                  ...get().deploymentStatuses,
                  [workflowId]: {
                    isDeployed: workflowData.isDeployed || false,
                    deployedAt: workflowData.deployedAt
                      ? new Date(workflowData.deployedAt)
                      : undefined,
                    apiKey: workflowData.apiKey || undefined,
                    needsRedeployment: false,
                  },
                }
              : get().deploymentStatuses

          const currentHydration = get().hydration
          if (
            currentHydration.requestId !== requestId ||
            currentHydration.workflowId !== workflowId
          ) {
            logger.info('Discarding stale workflow hydration result', {
              workflowId,
              requestId,
            })
            return
          }

          useWorkflowStore.setState(workflowState)
          useSubBlockStore.getState().initializeFromWorkflow(workflowId, workflowState.blocks || {})

          if (workflowData?.variables && typeof workflowData.variables === 'object') {
            useVariablesStore.setState((state) => {
              const withoutWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(([, v]: any) => v.workflowId !== workflowId)
              )
              return {
                variables: { ...withoutWorkflow, ...workflowData.variables },
              }
            })
          }

          window.dispatchEvent(
            new CustomEvent('active-workflow-changed', {
              detail: { workflowId },
            })
          )

          set((state) => ({
            activeWorkflowId: workflowId,
            error: null,
            deploymentStatuses: nextDeploymentStatuses,
            hydration: {
              phase: 'ready',
              workspaceId: state.hydration.workspaceId,
              workflowId,
              requestId,
              error: null,
            },
          }))

          logger.info(`Switched to workflow ${workflowId}`)
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : `Failed to load workflow ${workflowId}: Unknown error`
          logger.error(message)
          set((state) => ({
            error: message,
            hydration: {
              phase: 'error',
              workspaceId: state.hydration.workspaceId,
              workflowId,
              requestId: null,
              error: message,
            },
          }))
          throw error
        }
      },

      setActiveWorkflow: async (id: string) => {
        const { activeWorkflowId, hydration } = get()

        const workflowStoreState = useWorkflowStore.getState()
        const hasWorkflowData = Object.keys(workflowStoreState.blocks).length > 0

        // Skip loading only if:
        // - Same workflow is already active
        // - Workflow data exists
        // - Hydration is complete (phase is 'ready')
        const isFullyHydrated =
          activeWorkflowId === id &&
          hasWorkflowData &&
          hydration.phase === 'ready' &&
          hydration.workflowId === id

        if (isFullyHydrated) {
          logger.info(`Already active workflow ${id} with data loaded, skipping switch`)
          return
        }

        await get().loadWorkflowState(id)
      },

      /**
       * Duplicates an existing workflow
       */
      duplicateWorkflow: async (sourceId: string) => {
        const { workflows } = get()
        const sourceWorkflow = workflows[sourceId]

        if (!sourceWorkflow) {
          set({ error: `Workflow ${sourceId} not found` })
          return null
        }

        // Get the workspace ID from the source workflow (required)
        const workspaceId = sourceWorkflow.workspaceId

        // Call the server to duplicate the workflow - server generates all IDs
        let duplicatedWorkflow
        try {
          const response = await fetch(`/api/workflows/${sourceId}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${sourceWorkflow.name} (Copy)`,
              description: sourceWorkflow.description,
              color: sourceWorkflow.color,
              workspaceId: workspaceId,
              folderId: sourceWorkflow.folderId,
            }),
          })

          if (!response.ok) {
            throw new Error(`Failed to duplicate workflow: ${response.statusText}`)
          }

          duplicatedWorkflow = await response.json()
          logger.info(
            `Successfully duplicated workflow ${sourceId} to ${duplicatedWorkflow.id} with ${duplicatedWorkflow.blocksCount} blocks, ${duplicatedWorkflow.edgesCount} edges, ${duplicatedWorkflow.subflowsCount} subflows`
          )
        } catch (error) {
          logger.error(`Failed to duplicate workflow ${sourceId}:`, error)
          set({
            error: `Failed to duplicate workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
          return null
        }

        const id = duplicatedWorkflow.id

        const newWorkflow: WorkflowMetadata = {
          id,
          name: `${sourceWorkflow.name} (Copy)`,
          lastModified: new Date(),
          createdAt: new Date(),
          description: sourceWorkflow.description,
          color: getNextWorkflowColor(),
          workspaceId,
          folderId: sourceWorkflow.folderId,
          sortOrder: duplicatedWorkflow.sortOrder ?? 0,
        }

        // Get the current workflow state to copy from
        const currentWorkflowState = useWorkflowStore.getState()

        // If we're duplicating the active workflow, use current state
        // Otherwise, we need to fetch it from DB or use empty state
        let sourceState: any

        if (sourceId === get().activeWorkflowId) {
          // Source is the active workflow, copy current state
          sourceState = {
            blocks: currentWorkflowState.blocks || {},
            edges: currentWorkflowState.edges || [],
            loops: currentWorkflowState.loops || {},
            parallels: currentWorkflowState.parallels || {},
          }
        } else {
          const { workflowState } = buildDefaultWorkflowArtifacts()
          sourceState = {
            blocks: workflowState.blocks,
            edges: workflowState.edges,
            loops: workflowState.loops,
            parallels: workflowState.parallels,
          }
        }

        // Create the new workflow state with copied content
        const newState = {
          blocks: sourceState.blocks,
          edges: sourceState.edges,
          loops: sourceState.loops,
          parallels: sourceState.parallels,
          workspaceId,
          deploymentStatuses: {},
          lastSaved: Date.now(),
        }

        // Add workflow to registry
        set((state) => ({
          workflows: {
            ...state.workflows,
            [id]: newWorkflow,
          },
          error: null,
        }))

        // Copy subblock values if duplicating active workflow
        if (sourceId === get().activeWorkflowId) {
          const sourceSubblockValues = useSubBlockStore.getState().workflowValues[sourceId] || {}
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: sourceSubblockValues,
            },
          }))
        } else {
          // Initialize subblock values for starter block
          const subblockValues: Record<string, Record<string, any>> = {}
          Object.entries(newState.blocks).forEach(([blockId, block]) => {
            const blockState = block as any
            subblockValues[blockId] = {}
            Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
              subblockValues[blockId][subblockId] = (subblock as any).value
            })
          })

          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: subblockValues,
            },
          }))
        }

        try {
          await useVariablesStore.getState().loadForWorkflow(id)
        } catch (error) {
          logger.warn(`Error hydrating variables for duplicated workflow ${id}:`, error)
        }

        logger.info(
          `Duplicated workflow ${sourceId} to ${id} in workspace ${workspaceId || 'none'}`
        )

        return id
      },

      removeWorkflow: async (id: string) => {
        const { workflows, activeWorkflowId } = get()
        const workflowToDelete = workflows[id]

        if (!workflowToDelete) {
          logger.warn(`Attempted to delete non-existent workflow: ${id}`)
          return
        }

        const isDeletingActiveWorkflow = activeWorkflowId === id

        await withOptimisticUpdate({
          getCurrentState: () => ({
            workflows: { ...get().workflows },
            activeWorkflowId: get().activeWorkflowId,
            subBlockValues: { ...useSubBlockStore.getState().workflowValues },
            workflowStoreState: isDeletingActiveWorkflow
              ? {
                  blocks: { ...useWorkflowStore.getState().blocks },
                  edges: [...useWorkflowStore.getState().edges],
                  loops: { ...useWorkflowStore.getState().loops },
                  parallels: { ...useWorkflowStore.getState().parallels },
                  lastSaved: useWorkflowStore.getState().lastSaved,
                }
              : null,
          }),
          optimisticUpdate: () => {
            const newWorkflows = { ...get().workflows }
            delete newWorkflows[id]

            const currentSubBlockValues = useSubBlockStore.getState().workflowValues
            const newWorkflowValues = { ...currentSubBlockValues }
            delete newWorkflowValues[id]
            useSubBlockStore.setState({ workflowValues: newWorkflowValues })

            let newActiveWorkflowId = get().activeWorkflowId
            if (isDeletingActiveWorkflow) {
              newActiveWorkflowId = null

              useWorkflowStore.setState({
                blocks: {},
                edges: [],
                loops: {},
                parallels: {},
                lastSaved: Date.now(),
              })

              logger.info(
                `Cleared active workflow ${id} - user will need to manually select another workflow`
              )
            }

            set({
              workflows: newWorkflows,
              activeWorkflowId: newActiveWorkflowId,
              error: null,
            })

            logger.info(`Removed workflow ${id} from local state (optimistic)`)
          },
          apiCall: async () => {
            const response = await fetch(`/api/workflows/${id}`, {
              method: 'DELETE',
            })

            if (!response.ok) {
              const error = await response.json().catch(() => ({ error: 'Unknown error' }))
              throw new Error(error.error || 'Failed to delete workflow')
            }

            logger.info(`Successfully deleted workflow ${id} from database`)
          },
          rollback: (originalState) => {
            set({
              workflows: originalState.workflows,
              activeWorkflowId: originalState.activeWorkflowId,
            })

            useSubBlockStore.setState({ workflowValues: originalState.subBlockValues })

            if (originalState.workflowStoreState) {
              useWorkflowStore.setState(originalState.workflowStoreState)
              logger.info(`Restored workflow store state for workflow ${id}`)
            }

            logger.info(`Rolled back deletion of workflow ${id}`)
          },
          errorMessage: `Failed to delete workflow ${id}`,
        })
      },

      updateWorkflow: async (id: string, metadata: Partial<WorkflowMetadata>) => {
        const { workflows } = get()
        const workflow = workflows[id]
        if (!workflow) {
          logger.warn(`Cannot update workflow ${id}: not found in registry`)
          return
        }

        await withOptimisticUpdate({
          getCurrentState: () => workflow,
          optimisticUpdate: () => {
            set((state) => ({
              workflows: {
                ...state.workflows,
                [id]: {
                  ...workflow,
                  ...metadata,
                  lastModified: new Date(),
                  createdAt: workflow.createdAt, // Preserve creation date
                },
              },
              error: null,
            }))
          },
          apiCall: async () => {
            const response = await fetch(`/api/workflows/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(metadata),
            })

            if (!response.ok) {
              const error = await response.json()
              throw new Error(error.error || 'Failed to update workflow')
            }

            const { workflow: updatedWorkflow } = await response.json()
            logger.info(`Successfully updated workflow ${id} metadata`, metadata)

            set((state) => ({
              workflows: {
                ...state.workflows,
                [id]: {
                  ...state.workflows[id],
                  name: updatedWorkflow.name,
                  description: updatedWorkflow.description,
                  color: updatedWorkflow.color,
                  folderId: updatedWorkflow.folderId,
                  lastModified: new Date(updatedWorkflow.updatedAt),
                  createdAt: updatedWorkflow.createdAt
                    ? new Date(updatedWorkflow.createdAt)
                    : state.workflows[id].createdAt,
                },
              },
            }))
          },
          rollback: (originalWorkflow) => {
            set((state) => ({
              workflows: {
                ...state.workflows,
                [id]: originalWorkflow, // Revert to original state
              },
              error: `Failed to update workflow: ${metadata.name ? 'name' : 'metadata'}`,
            }))
          },
          errorMessage: `Failed to update workflow ${id} metadata`,
        })
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        resetWorkflowStores()

        set({
          activeWorkflowId: null,
          workflows: {},
          deploymentStatuses: {},
          error: null,
          hydration: initialHydration,
          clipboard: null,
        })

        logger.info('Logout complete - all workflow data cleared')
      },

      copyBlocks: (blockIds: string[]) => {
        if (blockIds.length === 0) return

        const workflowStore = useWorkflowStore.getState()
        const activeWorkflowId = get().activeWorkflowId
        const subBlockStore = useSubBlockStore.getState()

        const copiedBlocks: Record<string, BlockState> = {}
        const copiedSubBlockValues: Record<string, Record<string, unknown>> = {}
        const blockIdSet = new Set(blockIds)

        // Auto-include nested nodes from selected subflows
        blockIds.forEach((blockId) => {
          const loop = workflowStore.loops[blockId]
          if (loop?.nodes) loop.nodes.forEach((n) => blockIdSet.add(n))
          const parallel = workflowStore.parallels[blockId]
          if (parallel?.nodes) parallel.nodes.forEach((n) => blockIdSet.add(n))
        })

        blockIdSet.forEach((blockId) => {
          const block = workflowStore.blocks[blockId]
          if (block) {
            copiedBlocks[blockId] = JSON.parse(JSON.stringify(block))
            if (activeWorkflowId) {
              const blockValues = subBlockStore.workflowValues[activeWorkflowId]?.[blockId]
              if (blockValues) {
                copiedSubBlockValues[blockId] = JSON.parse(JSON.stringify(blockValues))
              }
            }
          }
        })

        const copiedEdges = workflowStore.edges.filter(
          (edge) => blockIdSet.has(edge.source) && blockIdSet.has(edge.target)
        )

        const copiedLoops: Record<string, Loop> = {}
        Object.entries(workflowStore.loops).forEach(([loopId, loop]) => {
          if (blockIdSet.has(loopId)) {
            copiedLoops[loopId] = JSON.parse(JSON.stringify(loop))
          }
        })

        const copiedParallels: Record<string, Parallel> = {}
        Object.entries(workflowStore.parallels).forEach(([parallelId, parallel]) => {
          if (blockIdSet.has(parallelId)) {
            copiedParallels[parallelId] = JSON.parse(JSON.stringify(parallel))
          }
        })

        set({
          clipboard: {
            blocks: copiedBlocks,
            edges: copiedEdges,
            subBlockValues: copiedSubBlockValues,
            loops: copiedLoops,
            parallels: copiedParallels,
            timestamp: Date.now(),
          },
        })

        logger.info('Copied blocks to clipboard', { count: Object.keys(copiedBlocks).length })
      },

      preparePasteData: (positionOffset = DEFAULT_DUPLICATE_OFFSET) => {
        const { clipboard, activeWorkflowId } = get()
        if (!clipboard || Object.keys(clipboard.blocks).length === 0) return null
        if (!activeWorkflowId) return null

        const workflowStore = useWorkflowStore.getState()
        const { blocks, edges, loops, parallels, subBlockValues } = regenerateBlockIds(
          clipboard.blocks,
          clipboard.edges,
          clipboard.loops,
          clipboard.parallels,
          clipboard.subBlockValues,
          positionOffset,
          workflowStore.blocks,
          getUniqueBlockName
        )

        return { blocks, edges, loops, parallels, subBlockValues }
      },

      hasClipboard: () => {
        const { clipboard } = get()
        return clipboard !== null && Object.keys(clipboard.blocks).length > 0
      },

      clearClipboard: () => {
        set({ clipboard: null })
      },

      setPendingSelection: (blockIds: string[]) => {
        set((state) => ({
          pendingSelection: [...(state.pendingSelection ?? []), ...blockIds],
        }))
      },

      clearPendingSelection: () => {
        set({ pendingSelection: null })
      },
    }),
    { name: 'workflow-registry' }
  )
)
