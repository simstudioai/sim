import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { API_ENDPOINTS, STORAGE_KEYS } from '../../constants'
import {
  loadWorkflowState,
  removeFromStorage,
  saveRegistry,
  saveSubblockValues,
  saveWorkflowState,
} from '../persistence'
import { useSubBlockStore } from '../subblock/store'
import { workflowSync } from '../sync'
import { useWorkflowStore } from '../workflow/store'
import { WorkflowMetadata, WorkflowRegistry } from './types'
import { generateUniqueName, getNextWorkflowColor } from './utils'

const logger = createLogger('Workflow Registry')

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      // Store state
      workflows: {},
      activeWorkflowId: null,
      isLoading: false,
      error: null,

      // Switch to a different workflow and manage state persistence
      setActiveWorkflow: async (id: string) => {
        const { workflows } = get()
        if (!workflows[id]) {
          set({ error: `Workflow ${id} not found` })
          return
        }

        // Save current workflow state before switching
        const currentId = get().activeWorkflowId
        if (currentId) {
          const currentState = useWorkflowStore.getState()

          // Save the complete state for the current workflow
          saveWorkflowState(currentId, {
            blocks: currentState.blocks,
            edges: currentState.edges,
            loops: currentState.loops,
            history: currentState.history,
            isDeployed: currentState.isDeployed,
            deployedAt: currentState.deployedAt,
            lastSaved: Date.now(),
          })

          // Also save current subblock values
          const currentSubblockValues = useSubBlockStore.getState().workflowValues[currentId]
          if (currentSubblockValues) {
            saveSubblockValues(currentId, currentSubblockValues)
          }
        }

        // Load workflow state for the new active workflow
        const parsedState = loadWorkflowState(id)
        if (parsedState) {
          const { blocks, edges, history, loops, isDeployed, deployedAt } = parsedState

          // Initialize subblock store with workflow values
          useSubBlockStore.getState().initializeFromWorkflow(id, blocks)

          // Set the workflow store state with the loaded state
          useWorkflowStore.setState({
            blocks,
            edges,
            loops,
            isDeployed: isDeployed !== undefined ? isDeployed : false,
            deployedAt: deployedAt ? new Date(deployedAt) : undefined,
            hasActiveSchedule: false,
            history: history || {
              past: [],
              present: {
                state: {
                  blocks,
                  edges,
                  loops: {},
                  isDeployed: isDeployed !== undefined ? isDeployed : false,
                  deployedAt: deployedAt,
                },
                timestamp: Date.now(),
                action: 'Initial state',
                subblockValues: {},
              },
              future: [],
            },
            lastSaved: parsedState.lastSaved || Date.now(),
          })

          logger.info(`Switched to workflow ${id}`)
        } else {
          // If no saved state, initialize with empty state
          useWorkflowStore.setState({
            blocks: {},
            edges: [],
            loops: {},
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

          logger.warn(`No saved state found for workflow ${id}, initialized with empty state`)
        }

        // Update the active workflow ID
        set({ activeWorkflowId: id, error: null })
      },

      /**
       * Creates a new workflow with appropriate metadata and initial blocks
       * @param options - Optional configuration for workflow creation
       * @returns The ID of the newly created workflow
       */
      createWorkflow: (options = {}) => {
        const { workflows } = get()
        const id = crypto.randomUUID()

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
        }

        let initialState

        // If this is a marketplace import with existing state
        if (options.marketplaceId && options.marketplaceState) {
          initialState = {
            blocks: options.marketplaceState.blocks || {},
            edges: options.marketplaceState.edges || [],
            loops: options.marketplaceState.loops || {},
            isDeployed: false,
            deployedAt: undefined,
            history: {
              past: [],
              present: {
                state: {
                  blocks: options.marketplaceState.blocks || {},
                  edges: options.marketplaceState.edges || [],
                  loops: options.marketplaceState.loops || {},
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
            isDeployed: false,
            deployedAt: undefined,
            history: {
              past: [],
              present: {
                state: {
                  blocks: {
                    [starterId]: starterBlock,
                  },
                  edges: [],
                  loops: {},
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
          }
        }

        // Add workflow to registry
        set((state) => ({
          workflows: {
            ...state.workflows,
            [id]: newWorkflow,
          },
          error: null,
        }))

        // Save workflow list to localStorage
        const updatedWorkflows = get().workflows
        saveRegistry(updatedWorkflows)

        // Save initial workflow state to localStorage
        saveWorkflowState(id, initialState)

        // Initialize subblock values if this is a marketplace import
        if (options.marketplaceId && options.marketplaceState?.blocks) {
          useSubBlockStore.getState().initializeFromWorkflow(id, options.marketplaceState.blocks)
        }

        // If this is the first workflow or it's an initial workflow, set it as active
        if (options.isInitial || Object.keys(updatedWorkflows).length === 1) {
          set({ activeWorkflowId: id })
          useWorkflowStore.setState(initialState)
        }

        // Trigger sync
        workflowSync.sync()

        return id
      },

      /**
       * Creates a new workflow from a marketplace workflow
       * @param marketplaceId - The ID of the marketplace workflow to import
       * @param state - The state of the marketplace workflow (blocks, edges, loops)
       * @param metadata - Additional metadata like name, description from marketplace
       * @returns The ID of the newly created workflow
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
          name: metadata.name || `Marketplace workflow`,
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
          isDeployed: false,
          deployedAt: undefined,
          history: {
            past: [],
            present: {
              state: {
                blocks: state.blocks || {},
                edges: state.edges || [],
                loops: state.loops || {},
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

        // Save workflow list to localStorage
        const updatedWorkflows = get().workflows
        saveRegistry(updatedWorkflows)

        // Save workflow state to localStorage
        saveWorkflowState(id, initialState)

        // Initialize subblock values from state blocks
        if (state.blocks) {
          useSubBlockStore.getState().initializeFromWorkflow(id, state.blocks)
        }

        // Trigger sync to save to the database with marketplace attributes
        workflowSync.sync()

        logger.info(`Created marketplace workflow ${id} imported from ${marketplaceId}`)

        return id
      },

      /**
       * Duplicates an existing workflow
       * @param sourceId - The ID of the workflow to duplicate
       * @returns The ID of the newly created workflow
       */
      duplicateWorkflow: (sourceId: string) => {
        const { workflows } = get()
        const sourceWorkflow = workflows[sourceId]
        
        if (!sourceWorkflow) {
          set({ error: `Workflow ${sourceId} not found` })
          return null
        }
        
        const id = crypto.randomUUID()
        
        // Load the source workflow state
        const sourceState = loadWorkflowState(sourceId)
        if (!sourceState) {
          set({ error: `No state found for workflow ${sourceId}` })
          return null
        }
        
        // Generate new workflow metadata
        const newWorkflow: WorkflowMetadata = {
          id,
          name: `${sourceWorkflow.name} (Copy)`,
          lastModified: new Date(),
          description: sourceWorkflow.description,
          color: getNextWorkflowColor(workflows),
          // Do not copy marketplace data
        }
        
        // Create new workflow state without deployment data
        const newState = {
          blocks: sourceState.blocks || {},
          edges: sourceState.edges || [],
          loops: sourceState.loops || {},
          isDeployed: false, // Reset deployment status
          deployedAt: undefined, // Reset deployment timestamp
          history: {
            past: [],
            present: {
              state: {
                blocks: sourceState.blocks || {},
                edges: sourceState.edges || [],
                loops: sourceState.loops || {},
                isDeployed: false,
                deployedAt: undefined,
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
        
        // Save workflow list to localStorage
        const updatedWorkflows = get().workflows
        saveRegistry(updatedWorkflows)
        
        // Save workflow state to localStorage
        saveWorkflowState(id, newState)
        
        // Copy subblock values from the source workflow
        const sourceSubblockValues = useSubBlockStore.getState().workflowValues[sourceId]
        if (sourceSubblockValues) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [id]: JSON.parse(JSON.stringify(sourceSubblockValues)), // Deep copy
            },
          }))
          
          // Save the copied subblock values
          saveSubblockValues(id, JSON.parse(JSON.stringify(sourceSubblockValues)))
        }
        
        // Trigger sync
        workflowSync.sync()
        
        logger.info(`Duplicated workflow ${sourceId} to ${id}`)
        
        return id
      },

      // Delete workflow and clean up associated storage
      removeWorkflow: (id: string) => {
        set((state) => {
          const newWorkflows = { ...state.workflows }
          delete newWorkflows[id]

          // Clean up localStorage
          removeFromStorage(STORAGE_KEYS.WORKFLOW(id))
          removeFromStorage(STORAGE_KEYS.SUBBLOCK(id))
          saveRegistry(newWorkflows)

          // Ensure any schedule for this workflow is cancelled
          // The API will handle the deletion of the schedule
          fetch(API_ENDPOINTS.SCHEDULE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: id,
              state: { blocks: {} }, // Empty blocks will signal to cancel the schedule
            }),
          }).catch((error) => {
            logger.error(`Error cancelling schedule for deleted workflow ${id}:`, { error })
          })

          // Sync deletion with database
          workflowSync.sync()

          // If deleting active workflow, switch to another one
          let newActiveWorkflowId = state.activeWorkflowId
          if (state.activeWorkflowId === id) {
            const remainingIds = Object.keys(newWorkflows)
            // Switch to first available workflow
            newActiveWorkflowId = remainingIds[0]
            const savedState = loadWorkflowState(newActiveWorkflowId)
            if (savedState) {
              const { blocks, edges, history, loops, isDeployed, deployedAt } = savedState
              useWorkflowStore.setState({
                blocks,
                edges,
                loops,
                isDeployed: isDeployed || false,
                deployedAt: deployedAt ? new Date(deployedAt) : undefined,
                hasActiveSchedule: false,
                history: history || {
                  past: [],
                  present: {
                    state: {
                      blocks,
                      edges,
                      loops,
                      isDeployed: isDeployed || false,
                      deployedAt,
                    },
                    timestamp: Date.now(),
                    action: 'Initial state',
                    subblockValues: {},
                  },
                  future: [],
                },
              })
            } else {
              useWorkflowStore.setState({
                blocks: {},
                edges: [],
                loops: {},
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

          return {
            workflows: newWorkflows,
            activeWorkflowId: newActiveWorkflowId,
            error: null,
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

          // Update localStorage
          saveRegistry(updatedWorkflows)

          // Use PUT for workflow updates
          workflowSync.sync()

          return {
            workflows: updatedWorkflows,
            error: null,
          }
        })
      },
    }),
    { name: 'workflow-registry' }
  )
)
