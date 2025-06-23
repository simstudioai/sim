import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { clearWorkflowVariablesTracking } from '@/stores/panel/variables/store'
import { API_ENDPOINTS } from '../../constants'
import { useSubBlockStore } from '../subblock/store'
import { fetchWorkflowsFromDB, workflowSync } from '../sync'
import { useWorkflowStore } from '../workflow/store'
import type { BlockState } from '../workflow/types'
import type { DeploymentStatus, WorkflowMetadata, WorkflowRegistry } from './types'
import { generateUniqueName, getNextWorkflowColor } from './utils'

const logger = createLogger('WorkflowRegistry')

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
      activeWorkspaceId: null, // No longer persisted in localStorage
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

      // Handle cleanup on workspace deletion
      handleWorkspaceDeletion: async (newWorkspaceId: string) => {
        const currentWorkspaceId = get().activeWorkspaceId

        if (!newWorkspaceId || newWorkspaceId === currentWorkspaceId) {
          logger.error('Cannot switch to invalid workspace after deletion')
          return
        }

        // Set transition state
        setWorkspaceTransitioning(true)

        try {
          logger.info(`Switching from deleted workspace ${currentWorkspaceId} to ${newWorkspaceId}`)

          // Reset all workflow state
          resetWorkflowStores()

          // Set loading state while we fetch workflows
          set({
            isLoading: true,
            workflows: {},
            activeWorkspaceId: newWorkspaceId,
            activeWorkflowId: null,
          })

          // Properly await workflow fetching to prevent race conditions
          await fetchWorkflowsFromDB()

          set({ isLoading: false })
          logger.info(`Successfully switched to workspace after deletion: ${newWorkspaceId}`)
        } catch (error) {
          logger.error('Error fetching workflows after workspace deletion:', {
            error,
            workspaceId: newWorkspaceId,
          })
          set({ isLoading: false, error: 'Failed to load workspace data' })
        } finally {
          // End transition state
          setWorkspaceTransitioning(false)
        }
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

        const { activeWorkspaceId: currentWorkspaceId } = get()

        // Early return if switching to the same workspace (before setting flag)
        if (currentWorkspaceId === workspaceId) {
          logger.info(`Already in workspace ${workspaceId}`)
          return
        }

        // Only set transition flag AFTER validating the switch is needed
        setWorkspaceTransitioning(true)

        try {
          logger.info(`Switching workspace from ${currentWorkspaceId || 'none'} to ${workspaceId}`)

          // Save to localStorage first before any async operations
          get().setActiveWorkspaceId(workspaceId)

          // Clear current workspace state
          resetWorkflowStores()

          // Update workspace in state
          set({
            activeWorkspaceId: workspaceId,
            activeWorkflowId: null,
            workflows: {},
            isLoading: true,
            error: null,
          })

          // Fetch workflows for the new workspace
          await fetchWorkflowsFromDB()

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

      // Load user's last active workspace from localStorage
      loadLastActiveWorkspace: async () => {
        try {
          const savedWorkspaceId = localStorage.getItem('lastActiveWorkspaceId')
          if (!savedWorkspaceId || savedWorkspaceId === get().activeWorkspaceId) {
            return // No saved workspace or already active
          }

          logger.info(`Attempting to restore last active workspace: ${savedWorkspaceId}`)

          // Validate that the workspace exists by making a simple API call
          try {
            const response = await fetch('/api/workspaces')
            if (response.ok) {
              const data = await response.json()
              const workspaces = data.workspaces || []
              const workspaceExists = workspaces.some((ws: any) => ws.id === savedWorkspaceId)

              if (workspaceExists) {
                // Set the validated workspace ID
                set({ activeWorkspaceId: savedWorkspaceId })
                logger.info(`Restored last active workspace from localStorage: ${savedWorkspaceId}`)
              } else {
                logger.warn(
                  `Saved workspace ${savedWorkspaceId} no longer exists, clearing from localStorage`
                )
                localStorage.removeItem('lastActiveWorkspaceId')
              }
            }
          } catch (apiError) {
            logger.warn('Failed to validate saved workspace, will use default:', apiError)
            // Don't remove from localStorage in case it's a temporary network issue
          }
        } catch (error) {
          logger.warn('Failed to load last active workspace from localStorage:', error)
          // This is non-critical, so we continue with default behavior
        }
      },

      // Load workspace based on workflow ID from URL, with fallback to last active workspace
      loadWorkspaceFromWorkflowId: async (workflowId: string | null) => {
        try {
          logger.info(`Loading workspace for workflow ID: ${workflowId}`)

          // If workflow ID provided, try to get its workspace
          if (workflowId) {
            try {
              const response = await fetch(`/api/workflows/${workflowId}`)
              if (response.ok) {
                const data = await response.json()
                const workflow = data.data

                if (workflow?.workspaceId) {
                  // Validate workspace access
                  const workspacesResponse = await fetch('/api/workspaces')
                  if (workspacesResponse.ok) {
                    const workspacesData = await workspacesResponse.json()
                    const workspaces = workspacesData.workspaces || []
                    const workspaceExists = workspaces.some(
                      (ws: any) => ws.id === workflow.workspaceId
                    )

                    if (workspaceExists) {
                      set({ activeWorkspaceId: workflow.workspaceId })
                      localStorage.setItem('lastActiveWorkspaceId', workflow.workspaceId)
                      logger.info(`Set active workspace from workflow: ${workflow.workspaceId}`)
                      return
                    }
                  }
                }
              }
            } catch (error) {
              logger.warn('Error fetching workflow:', error)
            }
          }

          // Fallback: use last active workspace or first available
          const savedWorkspaceId = localStorage.getItem('lastActiveWorkspaceId')
          const response = await fetch('/api/workspaces')

          if (response.ok) {
            const data = await response.json()
            const workspaces = data.workspaces || []

            if (workspaces.length === 0) {
              logger.warn('No workspaces found')
              return
            }

            // Try saved workspace first
            let targetWorkspace = savedWorkspaceId
              ? workspaces.find((ws: any) => ws.id === savedWorkspaceId)
              : null

            // Fall back to first workspace
            if (!targetWorkspace) {
              targetWorkspace = workspaces[0]
              if (savedWorkspaceId) {
                localStorage.removeItem('lastActiveWorkspaceId')
              }
            }

            set({ activeWorkspaceId: targetWorkspace.id })
            localStorage.setItem('lastActiveWorkspaceId', targetWorkspace.id)
            logger.info(`Set active workspace: ${targetWorkspace.id}`)
          }
        } catch (error) {
          logger.error('Error in loadWorkspaceFromWorkflowId:', error)
        }
      },

      // Simple method to set active workspace ID without triggering full switch
      setActiveWorkspaceId: (id: string) => {
        set({ activeWorkspaceId: id })
        // Save to localStorage as well
        try {
          localStorage.setItem('lastActiveWorkspaceId', id)
        } catch (error) {
          logger.warn('Failed to save workspace to localStorage:', error)
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

        // Trigger workflow sync to update server state
        workflowSync.sync()
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
        const { fetchWorkflowStateFromDB } = await import('@/stores/workflows/sync')
        const workflowData = await fetchWorkflowStateFromDB(id)

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
          // If no state in DB, initialize with starter block (for newly created workflows)
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

          workflowState = {
            blocks: { [starterId]: starterBlock },
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
                  blocks: { [starterId]: starterBlock },
                  edges: [],
                  loops: {},
                  parallels: {},
                  isDeployed: false,
                  deployedAt: undefined,
                },
                timestamp: Date.now(),
                action: 'Initial state with starter block',
                subblockValues: {},
              },
              future: [],
            },
            lastSaved: Date.now(),
          }

          // Initialize subblock values for starter block
          const subblockValues: Record<string, Record<string, any>> = {}
          subblockValues[starterId] = {}
          Object.entries(starterBlock.subBlocks).forEach(([subblockId, subblock]) => {
            subblockValues[starterId][subblockId] = (subblock as any).value
          })

          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: subblockValues,
            },
          }))
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

        logger.info(`Switched to workflow ${id}`)
      },

      /**
       * Creates a new workflow with appropriate metadata and initial blocks
       * @param options - Optional configuration for workflow creation
       * @returns The ID of the newly created workflow
       */
      createWorkflow: (options = {}) => {
        const { workflows, activeWorkspaceId } = get()
        const id = crypto.randomUUID()

        // Use provided workspace ID or fall back to active workspace ID
        const workspaceId = options.workspaceId || activeWorkspaceId || undefined

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

        // Mark as dirty for sync and trigger immediate sync
        useWorkflowStore.getState().sync.markDirty()
        useWorkflowStore.getState().sync.forceSync()

        logger.info(`Created new workflow with ID ${id} in workspace ${workspaceId || 'none'}`)

        return id
      },

      /**
       * Creates a new workflow from a marketplace workflow
       */
      createMarketplaceWorkflow: (
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

        // Mark as dirty to ensure sync
        useWorkflowStore.getState().sync.markDirty()

        // Trigger sync
        useWorkflowStore.getState().sync.forceSync()

        logger.info(`Created marketplace workflow ${id} imported from ${marketplaceId}`)

        return id
      },

      /**
       * Duplicates an existing workflow
       */
      duplicateWorkflow: (sourceId: string) => {
        const { workflows, activeWorkspaceId } = get()
        const sourceWorkflow = workflows[sourceId]

        if (!sourceWorkflow) {
          set({ error: `Workflow ${sourceId} not found` })
          return null
        }

        const id = crypto.randomUUID()

        // Get the workspace ID from the source workflow or fall back to active workspace
        const workspaceId = sourceWorkflow.workspaceId || activeWorkspaceId || undefined

        // Generate new workflow metadata
        const newWorkflow: WorkflowMetadata = {
          id,
          name: `${sourceWorkflow.name} (Copy)`,
          lastModified: new Date(),
          description: sourceWorkflow.description,
          color: getNextWorkflowColor(workflows),
          workspaceId, // Include the workspaceId in the new workflow
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

        // Mark as dirty for sync and trigger immediate sync
        useWorkflowStore.getState().sync.markDirty()
        useWorkflowStore.getState().sync.forceSync()

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

          // If deleting active workflow, switch to another one or clear state
          let newActiveWorkflowId = state.activeWorkflowId
          if (state.activeWorkflowId === id) {
            const remainingIds = Object.keys(newWorkflows)
            newActiveWorkflowId = remainingIds[0] || null

            // Ensure the workflow we're switching to actually exists
            if (newActiveWorkflowId && !newWorkflows[newActiveWorkflowId]) {
              logger.warn(`Attempted to switch to non-existent workflow ${newActiveWorkflowId}`)
              newActiveWorkflowId = null
            }

            if (!newActiveWorkflowId) {
              // No workflows left, initialize empty state
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
                    action: 'Initial state',
                    subblockValues: {},
                  },
                  future: [],
                },
                lastSaved: Date.now(),
              })
            }
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
      updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => {
        set((state) => {
          const workflow = state.workflows[id]
          if (!workflow) return state

          const updatedWorkflows = {
            ...state.workflows,
            [id]: {
              ...workflow,
              ...metadata,
              lastModified: new Date(),
            },
          }

          // Mark as dirty to ensure sync
          useWorkflowStore.getState().sync.markDirty()

          // Use PUT for workflow updates
          useWorkflowStore.getState().sync.forceSync()

          return {
            workflows: updatedWorkflows,
            error: null,
          }
        })
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        // Clear all state
        resetWorkflowStores()

        set({
          workflows: {},
          activeWorkflowId: null,
          activeWorkspaceId: null,
          isLoading: true,
          error: null,
        })

        logger.info('Logout complete - all workflow data cleared')
      },
    }),
    { name: 'workflow-registry' }
  )
)
