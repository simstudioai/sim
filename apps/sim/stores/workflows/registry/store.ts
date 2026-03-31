import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'
import type {
  DeploymentStatus,
  HydrationState,
  WorkflowRegistry,
} from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, regenerateBlockIds } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowRegistry')
const initialHydration: HydrationState = {
  phase: 'idle',
  workspaceId: null,
  workflowId: null,
  requestId: null,
  error: null,
}

const createRequestId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

function resetWorkflowStores() {
  useWorkflowStore.setState({
    currentWorkflowId: null,
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    deploymentStatuses: {},
    lastSaved: Date.now(),
  })

  useSubBlockStore.setState({
    workflowValues: {},
  })
}

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      activeWorkflowId: null,
      error: null,
      deploymentStatuses: {},
      hydration: initialHydration,
      clipboard: null,
      pendingSelection: null,

      switchToWorkspace: (workspaceId: string) => {
        logger.info(`Switching to workspace: ${workspaceId}`)

        resetWorkflowStores()
        void invalidateWorkflowLists(getQueryClient(), workspaceId)

        set({
          activeWorkflowId: null,
          deploymentStatuses: {},
          error: null,
          hydration: {
            phase: 'idle',
            workspaceId,
            workflowId: null,
            requestId: null,
            error: null,
          },
        })
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
                : (state.deploymentStatuses?.[workflowId as string]?.needsRedeployment ?? false),
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
        const workspaceId = get().hydration.workspaceId
        if (!workspaceId) {
          const message = `Cannot load workflow ${workflowId} without a workspace scope`
          logger.error(message)
          set({ error: message })
          throw new Error(message)
        }

        const requestId = createRequestId()

        set((state) => ({
          error: null,
          hydration: {
            phase: 'state-loading',
            workspaceId: workspaceId ?? state.hydration.workspaceId,
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

          let workflowState: WorkflowState

          if (workflowData?.state) {
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: workflowData.state.blocks || {},
              edges: workflowData.state.edges || [],
              loops: workflowData.state.loops || {},
              parallels: workflowData.state.parallels || {},
              lastSaved: Date.now(),
              deploymentStatuses: nextDeploymentStatuses,
            }
          } else {
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
              deploymentStatuses: nextDeploymentStatuses,
              lastSaved: Date.now(),
            }

            logger.info(
              `Workflow ${workflowId} has no state yet - will load from DB or show empty canvas`
            )
          }

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

          useWorkflowStore.getState().replaceWorkflowState(workflowState)
          useSubBlockStore.getState().initializeFromWorkflow(workflowId, workflowState.blocks || {})

          if (workflowData?.variables && typeof workflowData.variables === 'object') {
            useVariablesStore.setState((state) => {
              const withoutWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(
                  (entry): entry is [string, Variable] => entry[1].workflowId !== workflowId
                )
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

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        resetWorkflowStores()

        // Clear the React Query cache to remove all server state
        getQueryClient().clear()

        set({
          activeWorkflowId: null,
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
