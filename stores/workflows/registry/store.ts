import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { API_ENDPOINTS, STORAGE_KEYS } from '../../constants'
import {
  loadRegistry,
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

          console.log(`Switched to workflow ${id}`)
        } else {
          // If no saved state, initialize with empty state
          useWorkflowStore.setState({
            blocks: {},
            edges: [],
            loops: {},
            isDeployed: false,
            deployedAt: undefined,
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

          console.warn(`No saved state found for workflow ${id}, initialized with empty state`)
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
          name: generateUniqueName(workflows),
          lastModified: new Date(),
          description: 'New workflow',
          color: getNextWorkflowColor(workflows),
        }

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

        const initialState = {
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

        // If this is the first workflow or it's an initial workflow, set it as active
        if (options.isInitial || Object.keys(updatedWorkflows).length === 1) {
          set({ activeWorkflowId: id })
          useWorkflowStore.setState(initialState)
        }

        // Trigger sync
        workflowSync.sync()

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
            console.error(`Error cancelling schedule for deleted workflow ${id}:`, error)
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
                history: history || {
                  past: [],
                  present: {
                    state: { blocks, edges, loops, isDeployed: isDeployed || false, deployedAt },
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
