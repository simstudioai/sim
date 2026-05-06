import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { DEFAULT_DUPLICATE_OFFSET } from '@/lib/workflows/autolayout/constants'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { WorkflowDeploymentInfo } from '@/hooks/queries/deployments'
import { deploymentKeys } from '@/hooks/queries/deployments'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { useVariablesStore } from '@/stores/variables/store'
import type { Variable } from '@/stores/variables/types'
import type { HydrationState, WorkflowRegistry } from '@/stores/workflows/registry/types'
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
      hydration: initialHydration,
      clipboard: null,
      pendingSelection: null,

      switchToWorkspace: (workspaceId: string) => {
        logger.info(`Switching to workspace: ${workspaceId}`)

        resetWorkflowStores()
        void invalidateWorkflowLists(getQueryClient(), workspaceId)

        set({
          activeWorkflowId: null,
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
          const { data: workflowData } = await requestJson(getWorkflowStateContract, {
            params: { id: workflowId },
          })

          const deployedAt = workflowData.deployedAt ? workflowData.deployedAt.toISOString() : null

          getQueryClient().setQueryData<WorkflowDeploymentInfo>(
            deploymentKeys.info(workflowId),
            (prev) => ({
              isDeployed: workflowData.isDeployed,
              deployedAt,
              apiKey: prev?.apiKey ?? null,
              needsRedeployment: prev?.needsRedeployment ?? false,
              isPublicApi: workflowData.isPublicApi,
            })
          )

          let workflowState: WorkflowState

          if (workflowData?.state) {
            const wireState = workflowData.state as Pick<
              WorkflowState,
              'blocks' | 'edges' | 'loops' | 'parallels'
            >
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: wireState.blocks || {},
              edges: wireState.edges || [],
              loops: wireState.loops || {},
              parallels: wireState.parallels || {},
              lastSaved: Date.now(),
            }
          } else {
            workflowState = {
              currentWorkflowId: workflowId,
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
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

          const wireVariables = workflowData.variables
          if (wireVariables) {
            useVariablesStore.setState((state) => {
              const withoutWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(
                  (entry): entry is [string, Variable] => entry[1].workflowId !== workflowId
                )
              )
              return {
                variables: {
                  ...withoutWorkflow,
                  ...(wireVariables as Record<string, Variable>),
                },
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

          const currentHydration = get().hydration
          if (
            currentHydration.requestId !== requestId ||
            currentHydration.workflowId !== workflowId
          ) {
            logger.info('Discarding stale workflow error', { workflowId, requestId })
            return
          }

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

      markWorkflowCreating: (workflowId: string) => {
        set((state) => ({
          error: null,
          hydration: {
            phase: 'creating' as const,
            workspaceId: state.hydration.workspaceId,
            workflowId,
            requestId: null,
            error: null,
          },
        }))
        logger.info(`Marked workflow ${workflowId} as creating`)
      },

      markWorkflowCreated: (workflowId: string | null) => {
        const { hydration } = get()

        if (!workflowId) {
          if (hydration.phase === 'creating') {
            set((state) => ({
              hydration: {
                ...state.hydration,
                phase: 'idle' as const,
                workflowId: null,
                error: null,
              },
            }))
          }
          return
        }

        if (hydration.phase !== 'creating' || hydration.workflowId !== workflowId) {
          logger.info(
            `Ignoring markWorkflowCreated for ${workflowId} — hydration is ${hydration.phase}/${hydration.workflowId}`
          )
          return
        }

        logger.info(`Workflow ${workflowId} created, loading state`)
        get()
          .loadWorkflowState(workflowId)
          .catch((error) => {
            logger.error(`Failed to load newly created workflow ${workflowId}:`, error)
          })
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        resetWorkflowStores()

        // Clear the React Query cache to remove all server state
        getQueryClient().clear()

        set({
          activeWorkflowId: null,
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
