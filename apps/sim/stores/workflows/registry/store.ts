import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { clearWorkflowVariablesTracking } from '@/stores/panel/variables/store'
import { API_ENDPOINTS } from '../../constants'
import { useSubBlockStore } from '../subblock/store'
import { useWorkflowStore } from '../workflow/store'
import type { BlockState } from '../workflow/types'
import type { DeploymentStatus, WorkflowMetadata, WorkflowRegistry } from './types'
import { generateUniqueName, getNextWorkflowColor } from './utils'

const logger = createLogger('WorkflowRegistry')

let isFetching = false
let lastFetchTimestamp = 0

async function fetchWorkflowsFromDB(workspaceId?: string): Promise<void> {
  if (typeof window === 'undefined') return

  // Prevent concurrent fetch operations
  if (isFetching) {
    logger.info('Fetch already in progress, skipping duplicate request')
    return
  }

  const fetchStartTime = Date.now()
  isFetching = true

  try {
    useWorkflowRegistry.getState().setLoading(true)

    const url = new URL(API_ENDPOINTS.SYNC, window.location.origin)

    if (workspaceId) {
      url.searchParams.append('workspaceId', workspaceId)
    }

    const response = await fetch(url.toString(), { method: 'GET' })

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('User not authenticated for workflow fetch')
        useWorkflowRegistry.setState({ workflows: {}, isLoading: false })
        return
      }
      throw new Error(`Failed to fetch workflows: ${response.statusText}`)
    }

    // Check if this fetch is still relevant (not superseded by a newer fetch)
    if (fetchStartTime < lastFetchTimestamp) {
      logger.info('Fetch superseded by newer operation, discarding results')
      return
    }

    // Update timestamp to mark this as the most recent fetch
    lastFetchTimestamp = fetchStartTime

    const { data } = await response.json()

    if (!data || !Array.isArray(data)) {
      logger.info('No workflows found in database')

      // Only clear workflows if we're confident this is a legitimate empty state
      const currentWorkflows = useWorkflowRegistry.getState().workflows
      const hasExistingWorkflows = Object.keys(currentWorkflows).length > 0

      if (hasExistingWorkflows) {
        logger.warn(
          'Received empty workflow data but local workflows exist - possible race condition, preserving local state'
        )
        useWorkflowRegistry.setState({ isLoading: false })
        return
      }

      useWorkflowRegistry.setState({ workflows: {}, isLoading: false })
      return
    }

    // Process workflows
    const registryWorkflows: Record<string, WorkflowMetadata> = {}
    const deploymentStatuses: Record<string, any> = {}

    data.forEach((workflow) => {
      const {
        id,
        name,
        description,
        color,
        state,
        createdAt,
        marketplaceData,
        workspaceId,
        folderId,
        isDeployed,
        deployedAt,
        apiKey,
      } = workflow

      // No need to filter by workspace since we're already fetching for specific workspace

      // Add to registry
      registryWorkflows[id] = {
        id,
        name,
        description: description || '',
        color: color || '#3972F6',
        lastModified: createdAt ? new Date(createdAt) : new Date(),
        marketplaceData: marketplaceData || null,
        workspaceId,
        folderId: folderId || null,
      }

      // Extract deployment status from database
      if (isDeployed || deployedAt) {
        deploymentStatuses[id] = {
          isDeployed: isDeployed || false,
          deployedAt: deployedAt ? new Date(deployedAt) : undefined,
          apiKey: apiKey || undefined,
          needsRedeployment: false,
        }
      }

      // Initialize subblock values
      const subblockValues: Record<string, Record<string, any>> = {}
      if (state?.blocks) {
        Object.entries(state.blocks).forEach(([blockId, block]) => {
          const blockState = block as BlockState
          subblockValues[blockId] = {}

          Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
            subblockValues[blockId][subblockId] = subblock.value
          })
        })
      }

      // Update subblock store
      useSubBlockStore.setState((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [id]: subblockValues,
        },
      }))
    })

    // Update registry with loaded workflows and deployment statuses
    useWorkflowRegistry.setState({
      workflows: registryWorkflows,
      deploymentStatuses: deploymentStatuses,
      isLoading: false,
      error: null,
    })

    // Only set first workflow as active if no active workflow is set and we have workflows
    const currentState = useWorkflowRegistry.getState()
    if (!currentState.activeWorkflowId && Object.keys(registryWorkflows).length > 0) {
      const firstWorkflowId = Object.keys(registryWorkflows)[0]
      useWorkflowRegistry.setState({ activeWorkflowId: firstWorkflowId })
      logger.info(`Set first workflow as active: ${firstWorkflowId}`)
    }

    logger.info(
      `Successfully loaded ${Object.keys(registryWorkflows).length} workflows from database`
    )
  } catch (error) {
    logger.error('Error fetching workflows from DB:', error)
    useWorkflowRegistry.setState({
      isLoading: false,
      error: `Failed to load workflows: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    throw error
  } finally {
    isFetching = false
  }
}

// Track workspace transitions to prevent race conditions
let isWorkspaceTransitioning = false
const TRANSITION_TIMEOUT = 5000 // 5 seconds maximum for workspace transitions

// Resets workflow and subblock stores to prevent data leakage between workspaces
function resetWorkflowStores() {
  // Reset variable tracking to prevent stale API calls
  clearWorkflowVariablesTracking()

  // Reset the workflow store to prevent data leakage between workspaces
  useWorkflowStore.setState({
    blocks: {},
    edges: [],
    loops: {},
    isDeployed: false,
    deployedAt: undefined,
    deploymentStatuses: {}, // Reset deployment statuses map
    hasActiveSchedule: false,
    history: {
      past: [],
      present: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          isDeployed: false,
          deployedAt: undefined,
        },
        timestamp: Date.now(),
        action: 'Initial state',
        subblockValues: {},
      },
      future: [],
    },
    lastSaved: Date.now(),
  })

  // Reset the subblock store
  useSubBlockStore.setState({
    workflowValues: {},
    toolParams: {},
  })
}

/**
 * Handles workspace transition state tracking
 * @param isTransitioning Whether workspace is currently transitioning
 */
function setWorkspaceTransitioning(isTransitioning: boolean): void {
  isWorkspaceTransitioning = isTransitioning

  // Set a safety timeout to prevent permanently stuck in transition state
  if (isTransitioning) {
    setTimeout(() => {
      if (isWorkspaceTransitioning) {
        logger.warn('Forcing workspace transition to complete due to timeout')
        isWorkspaceTransitioning = false
      }
    }, TRANSITION_TIMEOUT)
  }
}

/**
 * Checks if workspace is currently in transition
 * @returns True if workspace is transitioning
 */
export function isWorkspaceInTransition(): boolean {
  return isWorkspaceTransitioning
}

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      // Store state
      workflows: {},
      activeWorkflowId: null,
      isLoading: true,
      error: null,
      // Initialize deployment statuses
      deploymentStatuses: {},

      // Set loading state
      setLoading: (loading: boolean) => {
        // Remove the broken logic that prevents loading when workflows exist
        // This was causing race conditions during deletion and sync operations
        set({ isLoading: loading })
      },

      // Simple method to load workflows (replaces sync system)
      loadWorkflows: async (workspaceId?: string) => {
        await fetchWorkflowsFromDB(workspaceId)
      },

      // Switch to workspace with comprehensive error handling and loading states
      switchToWorkspace: async (workspaceId: string) => {
        // Prevent multiple simultaneous transitions
        if (isWorkspaceTransitioning) {
          logger.warn(
            `Ignoring workspace switch to ${workspaceId} - transition already in progress`
          )
          return
        }

        // Set transition flag
        setWorkspaceTransitioning(true)

        try {
          logger.info(`Switching to workspace: ${workspaceId}`)

          // Clear current workspace state
          resetWorkflowStores()

          // Update state
          set({
            activeWorkflowId: null,
            workflows: {},
            isLoading: true,
            error: null,
          })

          // Fetch workflows for the new workspace
          await fetchWorkflowsFromDB(workspaceId)

          logger.info(`Successfully switched to workspace: ${workspaceId}`)
        } catch (error) {
          logger.error(`Error switching to workspace ${workspaceId}:`, { error })
          set({
            error: `Failed to switch workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false,
          })
        } finally {
          setWorkspaceTransitioning(false)
        }
      },

      // Method to get deployment status for a specific workflow
      getWorkflowDeploymentStatus: (workflowId: string | null): DeploymentStatus | null => {
        if (!workflowId) {
          // If no workflow ID provided, check the active workflow
          workflowId = get().activeWorkflowId
          if (!workflowId) return null
        }

        const { deploymentStatuses = {} } = get()

        // Get from the workflow-specific deployment statuses in the registry
        if (deploymentStatuses[workflowId]) {
          return deploymentStatuses[workflowId]
        }

        // No deployment status found
        return null
      },

      // Method to set deployment status for a specific workflow
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

        // Update the deployment statuses in the registry
        set((state) => ({
          deploymentStatuses: {
            ...state.deploymentStatuses,
            [workflowId as string]: {
              isDeployed,
              deployedAt: deployedAt || (isDeployed ? new Date() : undefined),
              apiKey,
              // Preserve existing needsRedeployment flag if available, but reset if newly deployed
              needsRedeployment: isDeployed
                ? false
                : ((state.deploymentStatuses?.[workflowId as string] as any)?.needsRedeployment ??
                  false),
            },
          },
        }))

        // Also update the workflow store if this is the active workflow
        const { activeWorkflowId } = get()
        if (workflowId === activeWorkflowId) {
          // Update the workflow store for backward compatibility
          useWorkflowStore.setState((state) => ({
            isDeployed,
            deployedAt: deployedAt || (isDeployed ? new Date() : undefined),
            needsRedeployment: isDeployed ? false : state.needsRedeployment,
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
        }

        // Note: Socket.IO handles real-time sync automatically
      },

      // Method to set the needsRedeployment flag for a specific workflow
      setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => {
        if (!workflowId) {
          workflowId = get().activeWorkflowId
          if (!workflowId) return
        }

        // Update the registry's deployment status for this specific workflow
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

        // Only update the global flag if this is the active workflow
        const { activeWorkflowId } = get()
        if (workflowId === activeWorkflowId) {
          useWorkflowStore.getState().setNeedsRedeploymentFlag(needsRedeployment)
        }
      },

      // Modified setActiveWorkflow to work with clean DB-only architecture
      setActiveWorkflow: async (id: string) => {
        const { workflows, activeWorkflowId } = get()
        if (!workflows[id]) {
          set({ error: `Workflow ${id} not found` })
          return
        }

        // First, sync the current workflow before switching (if there is one)
        if (activeWorkflowId && activeWorkflowId !== id) {
          // Mark current workflow as dirty and sync (fire and forget)
          useWorkflowStore.getState().sync.markDirty()
          useWorkflowStore.getState().sync.forceSync()
        }

        // Fetch workflow state from database
        const response = await fetch(`/api/workflows/${id}`, { method: 'GET' })
        const workflowData = response.ok ? (await response.json()).data : null

        let workflowState: any

        if (workflowData?.state) {
          // Use the state from the database
          workflowState = {
            blocks: workflowData.state.blocks || {},
            edges: workflowData.state.edges || [],
            loops: workflowData.state.loops || {},
            parallels: workflowData.state.parallels || {},
            isDeployed: workflowData.isDeployed || false,
            deployedAt: workflowData.deployedAt ? new Date(workflowData.deployedAt) : undefined,
            apiKey: workflowData.apiKey,
            lastSaved: Date.now(),
            marketplaceData: workflowData.marketplaceData || null,
            deploymentStatuses: {},
            hasActiveSchedule: false,
            history: {
              past: [],
              present: {
                state: workflowData.state,
                timestamp: Date.now(),
                action: 'Loaded from database',
                subblockValues: {},
              },
              future: [],
            },
          }

          // Extract and update subblock values
          const subblockValues: Record<string, Record<string, any>> = {}
          Object.entries(workflowState.blocks).forEach(([blockId, block]) => {
            const blockState = block as any
            subblockValues[blockId] = {}
            Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
              subblockValues[blockId][subblockId] = (subblock as any).value
            })
          })

          // Update subblock store for this workflow
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: subblockValues,
            },
          }))
        } else {
          // If no state in DB, use empty state - server should have created start block
          workflowState = {
            blocks: {},
            edges: [],
            loops: {},
            parallels: {},
            isDeployed: false,
            deployedAt: undefined,
            deploymentStatuses: {},
            hasActiveSchedule: false,
            history: {
              past: [],
              present: {
                state: {
                  blocks: {},
                  edges: [],
                  loops: {},
                  parallels: {},
                  isDeployed: false,
                  deployedAt: undefined,
                },
                timestamp: Date.now(),
                action: 'Empty initial state - server should provide start block',
                subblockValues: {},
              },
              future: [],
            },
            lastSaved: Date.now(),
          }

          logger.warn(
            `Workflow ${id} has no state in DB - this should not happen with server-side start block creation`
          )
        }

        // Set the workflow state in the store
        useWorkflowStore.setState(workflowState)

        // CRITICAL: Set deployment status in registry when switching to workflow
        if (workflowData?.isDeployed || workflowData?.deployedAt) {
          set((state) => ({
            deploymentStatuses: {
              ...state.deploymentStatuses,
              [id]: {
                isDeployed: workflowData.isDeployed || false,
                deployedAt: workflowData.deployedAt ? new Date(workflowData.deployedAt) : undefined,
                apiKey: workflowData.apiKey || undefined,
                needsRedeployment: false, // Default to false when loading from DB
              },
            },
          }))
        }

        // Update the active workflow ID
        set({ activeWorkflowId: id, error: null })

        // Emit a global event to notify that the active workflow has changed
        // This allows the workflow component to join the socket room
        window.dispatchEvent(
          new CustomEvent('active-workflow-changed', {
            detail: { workflowId: id },
          })
        )

        logger.info(`Switched to workflow ${id}`)
      },

      /**
       * Creates a new workflow with appropriate metadata and initial blocks
       * @param options - Optional configuration for workflow creation
       * @returns The ID of the newly created workflow
       */
      createWorkflow: async (options = {}) => {
        const { workflows } = get()
        const id = crypto.randomUUID()

        // Use provided workspace ID (must be provided since we no longer track active workspace)
        const workspaceId = options.workspaceId

        if (!workspaceId) {
          logger.error('Cannot create workflow without workspaceId')
          set({ error: 'Workspace ID is required to create a workflow' })
          throw new Error('Workspace ID is required to create a workflow')
        }

        logger.info(`Creating new workflow in workspace: ${workspaceId || 'none'}`)
        // Generate workflow metadata with appropriate name and color
        const newWorkflow: WorkflowMetadata = {
          id,
          name: options.name || generateUniqueName(workflows),
          lastModified: new Date(),
          description: options.description || 'New workflow',
          color: options.marketplaceId ? '#808080' : getNextWorkflowColor(workflows), // Gray for marketplace imports
          marketplaceData: options.marketplaceId
            ? { id: options.marketplaceId, status: 'temp' as const }
            : undefined,
          workspaceId, // Associate with workspace
          folderId: options.folderId || null, // Associate with folder if provided
        }

        let initialState: any

        // If this is a marketplace import with existing state
        if (options.marketplaceId && options.marketplaceState) {
          initialState = {
            blocks: options.marketplaceState.blocks || {},
            edges: options.marketplaceState.edges || [],
            loops: options.marketplaceState.loops || {},
            parallels: options.marketplaceState.parallels || {},
            isDeployed: false,
            deployedAt: undefined,
            deploymentStatuses: {}, // Initialize empty deployment statuses map
            workspaceId, // Include workspace ID in the state object
            history: {
              past: [],
              present: {
                state: {
                  blocks: options.marketplaceState.blocks || {},
                  edges: options.marketplaceState.edges || [],
                  loops: options.marketplaceState.loops || {},
                  parallels: options.marketplaceState.parallels || {},
                  isDeployed: false,
                  deployedAt: undefined,
                  workspaceId, // Include workspace ID in history
                },
                timestamp: Date.now(),
                action: 'Imported from marketplace',
                subblockValues: {},
              },
              future: [],
            },
            lastSaved: Date.now(),
          }

          logger.info(`Created workflow from marketplace: ${options.marketplaceId}`)
        } else {
          // Create starter block for new workflow
          const starterId = crypto.randomUUID()
          const starterBlock = {
            id: starterId,
            type: 'starter' as const,
            name: 'Start',
            position: { x: 100, y: 100 },
            subBlocks: {
              startWorkflow: {
                id: 'startWorkflow',
                type: 'dropdown' as const,
                value: 'manual',
              },
              webhookPath: {
                id: 'webhookPath',
                type: 'short-input' as const,
                value: '',
              },
              webhookSecret: {
                id: 'webhookSecret',
                type: 'short-input' as const,
                value: '',
              },
              scheduleType: {
                id: 'scheduleType',
                type: 'dropdown' as const,
                value: 'daily',
              },
              minutesInterval: {
                id: 'minutesInterval',
                type: 'short-input' as const,
                value: '',
              },
              minutesStartingAt: {
                id: 'minutesStartingAt',
                type: 'short-input' as const,
                value: '',
              },
              hourlyMinute: {
                id: 'hourlyMinute',
                type: 'short-input' as const,
                value: '',
              },
              dailyTime: {
                id: 'dailyTime',
                type: 'short-input' as const,
                value: '',
              },
              weeklyDay: {
                id: 'weeklyDay',
                type: 'dropdown' as const,
                value: 'MON',
              },
              weeklyDayTime: {
                id: 'weeklyDayTime',
                type: 'short-input' as const,
                value: '',
              },
              monthlyDay: {
                id: 'monthlyDay',
                type: 'short-input' as const,
                value: '',
              },
              monthlyTime: {
                id: 'monthlyTime',
                type: 'short-input' as const,
                value: '',
              },
              cronExpression: {
                id: 'cronExpression',
                type: 'short-input' as const,
                value: '',
              },
              timezone: {
                id: 'timezone',
                type: 'dropdown' as const,
                value: 'UTC',
              },
            },
            outputs: {
              response: {
                type: {
                  input: 'any',
                },
              },
            },
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            height: 0,
          }

          initialState = {
            blocks: {
              [starterId]: starterBlock,
            },
            edges: [],
            loops: {},
            parallels: {},
            isDeployed: false,
            deployedAt: undefined,
            deploymentStatuses: {}, // Initialize empty deployment statuses map
            workspaceId, // Include workspace ID in the state object
            history: {
              past: [],
              present: {
                state: {
                  blocks: {
                    [starterId]: starterBlock,
                  },
                  edges: [],
                  loops: {},
                  parallels: {},
                  isDeployed: false,
                  deployedAt: undefined,
                  workspaceId, // Include workspace ID in history
                },
                timestamp: Date.now(),
                action: 'Initial state',
                subblockValues: {},
              },
              future: [],
            },
            lastSaved: Date.now(),
          }
        }

        // Add workflow to registry first
        set((state) => ({
          workflows: {
            ...state.workflows,
            [id]: newWorkflow,
          },
          error: null,
        }))

        // Initialize subblock values if this is a marketplace import
        if (options.marketplaceId && options.marketplaceState?.blocks) {
          useSubBlockStore.getState().initializeFromWorkflow(id, options.marketplaceState.blocks)
        }

        // Initialize subblock values to ensure they're available for sync
        if (!options.marketplaceId) {
          // For non-marketplace workflows, initialize subblock values from the starter block
          const subblockValues: Record<string, Record<string, any>> = {}
          const blocks = initialState.blocks as Record<string, BlockState>
          for (const [blockId, block] of Object.entries(blocks)) {
            subblockValues[blockId] = {}
            for (const [subblockId, subblock] of Object.entries(block.subBlocks)) {
              subblockValues[blockId][subblockId] = (subblock as any).value
            }
          }

          // Update the subblock store with the initial values
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: subblockValues,
            },
          }))
        }

        // Properly set as active workflow and initialize state
        set({ activeWorkflowId: id })
        useWorkflowStore.setState(initialState)

        // Immediately persist the new workflow to the database using dedicated endpoint
        const persistWorkflow = async () => {
          try {
            const response = await fetch('/api/workflows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: newWorkflow.name,
                description: newWorkflow.description,
                color: newWorkflow.color,
                workspaceId: newWorkflow.workspaceId,
                folderId: newWorkflow.folderId,
              }),
            })

            if (!response.ok) {
              const errorData = await response.json()
              throw new Error(
                `Failed to create workflow: ${errorData.error || response.statusText}`
              )
            }

            const createdWorkflow = await response.json()
            logger.info(`Successfully created workflow ${createdWorkflow.id} on server`)

            // Update the local workflow ID to match the server-generated one
            if (createdWorkflow.id !== id) {
              logger.info(`Updating local workflow ID from ${id} to ${createdWorkflow.id}`)

              // Update registry with server ID
              set((state) => {
                const { [id]: oldWorkflow, ...otherWorkflows } = state.workflows
                return {
                  workflows: {
                    ...otherWorkflows,
                    [createdWorkflow.id]: {
                      ...oldWorkflow,
                      id: createdWorkflow.id,
                    },
                  },
                  activeWorkflowId: createdWorkflow.id,
                }
              })

              // Return the server ID for the caller
              return createdWorkflow.id
            }

            return id
          } catch (error) {
            logger.error(`Failed to create new workflow ${id}:`, error)
            throw error // Re-throw to handle in calling code
          }
        }

        // Persist synchronously to ensure workflow exists before Socket.IO operations
        let finalId = id
        try {
          finalId = await persistWorkflow()
        } catch (error) {
          logger.error(
            `Critical: Failed to persist new workflow ${id}, Socket.IO operations may fail:`,
            error
          )
          // Don't throw - allow workflow creation to continue in memory
        }

        logger.info(`Created new workflow with ID ${finalId} in workspace ${workspaceId || 'none'}`)

        return finalId
      },

      /**
       * Creates a new workflow from a marketplace workflow
       */
      createMarketplaceWorkflow: async (
        marketplaceId: string,
        state: any,
        metadata: Partial<WorkflowMetadata>
      ) => {
        const { workflows } = get()
        const id = crypto.randomUUID()

        // Generate workflow metadata with marketplace properties
        const newWorkflow: WorkflowMetadata = {
          id,
          name: metadata.name || 'Marketplace workflow',
          lastModified: new Date(),
          description: metadata.description || 'Imported from marketplace',
          color: metadata.color || getNextWorkflowColor(workflows),
          marketplaceData: { id: marketplaceId, status: 'temp' as const },
        }

        // Prepare workflow state based on the marketplace workflow state
        const initialState = {
          blocks: state.blocks || {},
          edges: state.edges || [],
          loops: state.loops || {},
          parallels: state.parallels || {},
          isDeployed: false,
          deployedAt: undefined,
          history: {
            past: [],
            present: {
              state: {
                blocks: state.blocks || {},
                edges: state.edges || [],
                loops: state.loops || {},
                parallels: state.parallels || {},
                isDeployed: false,
                deployedAt: undefined,
              },
              timestamp: Date.now(),
              action: 'Imported from marketplace',
              subblockValues: {},
            },
            future: [],
          },
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

        // Initialize subblock values from state blocks
        if (state.blocks) {
          useSubBlockStore.getState().initializeFromWorkflow(id, state.blocks)
        }

        // Set as active workflow and update store
        set({ activeWorkflowId: id })
        useWorkflowStore.setState(initialState)

        // Immediately persist the marketplace workflow to the database
        const persistWorkflow = async () => {
          try {
            const workflowData = {
              [id]: {
                id,
                name: newWorkflow.name,
                description: newWorkflow.description,
                color: newWorkflow.color,
                state: initialState,
                marketplaceData: newWorkflow.marketplaceData,
                workspaceId: newWorkflow.workspaceId,
                folderId: newWorkflow.folderId,
              },
            }

            const response = await fetch('/api/workflows/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflows: workflowData,
                workspaceId: newWorkflow.workspaceId,
              }),
            })

            if (!response.ok) {
              throw new Error(`Failed to persist workflow: ${response.statusText}`)
            }

            logger.info(`Successfully persisted marketplace workflow ${id} to database`)
          } catch (error) {
            logger.error(`Failed to persist marketplace workflow ${id}:`, error)
          }
        }

        // Persist synchronously to ensure workflow exists before Socket.IO operations
        try {
          await persistWorkflow()
        } catch (error) {
          logger.error(
            `Critical: Failed to persist marketplace workflow ${id}, Socket.IO operations may fail:`,
            error
          )
          // Don't throw - allow workflow creation to continue in memory
        }

        logger.info(`Created marketplace workflow ${id} imported from ${marketplaceId}`)

        return id
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

        // Use the server-generated ID
        const id = duplicatedWorkflow.id

        // Generate new workflow metadata using the server-generated ID
        const newWorkflow: WorkflowMetadata = {
          id,
          name: `${sourceWorkflow.name} (Copy)`,
          lastModified: new Date(),
          description: sourceWorkflow.description,
          color: getNextWorkflowColor(workflows),
          workspaceId, // Include the workspaceId in the new workflow
          folderId: sourceWorkflow.folderId, // Include the folderId from source workflow
          // Do not copy marketplace data
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
          // Source is not active workflow, create with starter block for now
          // In a future enhancement, we could fetch from DB
          const starterId = crypto.randomUUID()
          const starterBlock = {
            id: starterId,
            type: 'starter' as const,
            name: 'Start',
            position: { x: 100, y: 100 },
            subBlocks: {
              startWorkflow: {
                id: 'startWorkflow',
                type: 'dropdown' as const,
                value: 'manual',
              },
              webhookPath: {
                id: 'webhookPath',
                type: 'short-input' as const,
                value: '',
              },
              webhookSecret: {
                id: 'webhookSecret',
                type: 'short-input' as const,
                value: '',
              },
              scheduleType: {
                id: 'scheduleType',
                type: 'dropdown' as const,
                value: 'daily',
              },
              minutesInterval: {
                id: 'minutesInterval',
                type: 'short-input' as const,
                value: '',
              },
              minutesStartingAt: {
                id: 'minutesStartingAt',
                type: 'short-input' as const,
                value: '',
              },
              hourlyMinute: {
                id: 'hourlyMinute',
                type: 'short-input' as const,
                value: '',
              },
              dailyTime: {
                id: 'dailyTime',
                type: 'short-input' as const,
                value: '',
              },
              weeklyDay: {
                id: 'weeklyDay',
                type: 'dropdown' as const,
                value: 'MON',
              },
              weeklyDayTime: {
                id: 'weeklyDayTime',
                type: 'short-input' as const,
                value: '',
              },
              monthlyDay: {
                id: 'monthlyDay',
                type: 'short-input' as const,
                value: '',
              },
              monthlyTime: {
                id: 'monthlyTime',
                type: 'short-input' as const,
                value: '',
              },
              cronExpression: {
                id: 'cronExpression',
                type: 'short-input' as const,
                value: '',
              },
              timezone: {
                id: 'timezone',
                type: 'dropdown' as const,
                value: 'UTC',
              },
            },
            outputs: {
              response: {
                type: {
                  input: 'any',
                },
              },
            },
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            height: 0,
          }

          sourceState = {
            blocks: { [starterId]: starterBlock },
            edges: [],
            loops: {},
            parallels: {},
          }
        }

        // Create the new workflow state with copied content
        const newState = {
          blocks: sourceState.blocks,
          edges: sourceState.edges,
          loops: sourceState.loops,
          parallels: sourceState.parallels,
          isDeployed: false,
          deployedAt: undefined,
          workspaceId,
          deploymentStatuses: {},
          history: {
            past: [],
            present: {
              state: {
                blocks: sourceState.blocks,
                edges: sourceState.edges,
                loops: sourceState.loops,
                parallels: sourceState.parallels,
                isDeployed: false,
                deployedAt: undefined,
                workspaceId,
              },
              timestamp: Date.now(),
              action: 'Duplicated workflow',
              subblockValues: {},
            },
            future: [],
          },
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

        // Set as active workflow and update store
        set({ activeWorkflowId: id })
        useWorkflowStore.setState(newState)

        // Workflow has already been persisted to the database via the duplication endpoint

        logger.info(
          `Duplicated workflow ${sourceId} to ${id} in workspace ${workspaceId || 'none'}`
        )

        return id
      },

      // Delete workflow and clean up associated storage
      removeWorkflow: async (id: string) => {
        const { workflows } = get()
        const workflowToDelete = workflows[id]

        if (!workflowToDelete) {
          logger.warn(`Attempted to delete non-existent workflow: ${id}`)
          return
        }
        set({ isLoading: true, error: null })

        try {
          // Call DELETE endpoint to remove from database
          const response = await fetch(`/api/workflows/${id}`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(error.error || 'Failed to delete workflow')
          }

          logger.info(`Successfully deleted workflow ${id} from database`)
        } catch (error) {
          logger.error(`Failed to delete workflow ${id} from database:`, error)
          set({
            error: `Failed to delete workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false,
          })
          return
        }

        // Only update local state after successful deletion from database
        set((state) => {
          const newWorkflows = { ...state.workflows }
          delete newWorkflows[id]

          // Clean up subblock values for this workflow
          useSubBlockStore.setState((subBlockState) => {
            const newWorkflowValues = { ...subBlockState.workflowValues }
            delete newWorkflowValues[id]
            return { workflowValues: newWorkflowValues }
          })

          // If deleting active workflow, clear active workflow ID immediately
          // Don't automatically switch to another workflow to prevent race conditions
          let newActiveWorkflowId = state.activeWorkflowId
          if (state.activeWorkflowId === id) {
            newActiveWorkflowId = null

            // Clear workflow store state immediately when deleting active workflow
            useWorkflowStore.setState({
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
              isDeployed: false,
              deployedAt: undefined,
              hasActiveSchedule: false,
              history: {
                past: [],
                present: {
                  state: {
                    blocks: {},
                    edges: [],
                    loops: {},
                    parallels: {},
                    isDeployed: false,
                    deployedAt: undefined,
                  },
                  timestamp: Date.now(),
                  action: 'Workflow deleted',
                  subblockValues: {},
                },
                future: [],
              },
              lastSaved: Date.now(),
            })

            logger.info(
              `Cleared active workflow ${id} - user will need to manually select another workflow`
            )
          }

          // Cancel any schedule for this workflow (async, don't wait)
          fetch(API_ENDPOINTS.SCHEDULE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: id,
              state: {
                blocks: {},
                edges: [],
                loops: {},
              },
            }),
          }).catch((error) => {
            logger.error(`Error cancelling schedule for deleted workflow ${id}:`, error)
          })

          logger.info(`Removed workflow ${id} from local state`)

          return {
            workflows: newWorkflows,
            activeWorkflowId: newActiveWorkflowId,
            error: null,
            isLoading: false, // Clear loading state after successful deletion
          }
        })
      },

      // Update workflow metadata
      updateWorkflow: async (id: string, metadata: Partial<WorkflowMetadata>) => {
        const { workflows } = get()
        const workflow = workflows[id]
        if (!workflow) {
          logger.warn(`Cannot update workflow ${id}: not found in registry`)
          return
        }

        // Optimistically update local state first
        set((state) => ({
          workflows: {
            ...state.workflows,
            [id]: {
              ...workflow,
              ...metadata,
              lastModified: new Date(),
            },
          },
          error: null,
        }))

        // Persist to database via API
        try {
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

          // Update with server response to ensure consistency
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
              },
            },
          }))
        } catch (error) {
          logger.error(`Failed to update workflow ${id} metadata:`, error)

          // Revert optimistic update on error
          set((state) => ({
            workflows: {
              ...state.workflows,
              [id]: workflow, // Revert to original state
            },
            error: `Failed to update workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }))
        }
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        // Clear all state
        resetWorkflowStores()

        set({
          workflows: {},
          activeWorkflowId: null,
          isLoading: true,
          error: null,
        })

        logger.info('Logout complete - all workflow data cleared')
      },
    }),
    { name: 'workflow-registry' }
  )
)
