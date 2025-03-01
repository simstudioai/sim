import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { addDeletedWorkflow } from '../../sync-manager'
import { useWorkflowStore } from '../store'
import { useSubBlockStore } from '../subblock/store'
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
          localStorage.setItem(
            `workflow-${currentId}`,
            JSON.stringify({
              blocks: currentState.blocks,
              edges: currentState.edges,
              loops: currentState.loops,
              history: currentState.history,
              isDeployed: currentState.isDeployed,
              deployedAt: currentState.deployedAt,
            })
          )
        }

        // Load workflow state
        const savedState = localStorage.getItem(`workflow-${id}`)
        if (savedState) {
          const parsedState = JSON.parse(savedState)
          const { blocks, edges, history, loops } = parsedState

          // Initialize subblock store with workflow values
          useSubBlockStore.getState().initializeFromWorkflow(id, blocks)

          useWorkflowStore.setState({
            blocks,
            edges,
            loops,
            isDeployed: parsedState.isDeployed !== undefined ? parsedState.isDeployed : false,
            deployedAt: parsedState.deployedAt ? new Date(parsedState.deployedAt) : undefined,
            history: history || {
              past: [],
              present: {
                state: {
                  blocks,
                  edges,
                  loops: {},
                  isDeployed: parsedState.isDeployed !== undefined ? parsedState.isDeployed : false,
                  deployedAt: parsedState.deployedAt,
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
        localStorage.setItem('workflow-registry', JSON.stringify(updatedWorkflows))

        // Save initial workflow state to localStorage
        localStorage.setItem(`workflow-${id}`, JSON.stringify(initialState))

        // If this is the first workflow or it's an initial workflow, set it as active
        if (options.isInitial || Object.keys(updatedWorkflows).length === 1) {
          set({ activeWorkflowId: id })
          useWorkflowStore.setState(initialState)
        }

        return id
      },

      // Delete workflow and clean up associated storage
      removeWorkflow: (id: string) => {
        set((state) => {
          const newWorkflows = { ...state.workflows }
          delete newWorkflows[id]

          // Track deletion for next sync
          addDeletedWorkflow(id)

          // Remove workflow state from localStorage
          localStorage.removeItem(`workflow-${id}`)

          // Update registry in localStorage
          localStorage.setItem('workflow-registry', JSON.stringify(newWorkflows))

          // If deleting active workflow, switch to another one
          let newActiveWorkflowId = state.activeWorkflowId
          if (state.activeWorkflowId === id) {
            const remainingIds = Object.keys(newWorkflows)
            // Switch to first available workflow
            newActiveWorkflowId = remainingIds[0]
            const savedState = localStorage.getItem(`workflow-${newActiveWorkflowId}`)
            if (savedState) {
              const { blocks, edges, history, loops, isDeployed, deployedAt } =
                JSON.parse(savedState)
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

          // Update registry in localStorage
          localStorage.setItem('workflow-registry', JSON.stringify(updatedWorkflows))

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

// Initialize registry from localStorage and set up persistence
const initializeRegistry = () => {
  const savedRegistry = localStorage.getItem('workflow-registry')
  if (savedRegistry) {
    const workflows = JSON.parse(savedRegistry)
    useWorkflowRegistry.setState({ workflows })
  }

  // Add event listeners for page unload
  window.addEventListener('beforeunload', () => {
    const currentId = useWorkflowRegistry.getState().activeWorkflowId
    if (currentId) {
      const currentState = useWorkflowStore.getState()
      localStorage.setItem(
        `workflow-${currentId}`,
        JSON.stringify({
          blocks: currentState.blocks,
          edges: currentState.edges,
          loops: currentState.loops,
          history: currentState.history,
          isDeployed: currentState.isDeployed,
          deployedAt: currentState.deployedAt,
        })
      )
    }
  })
}

if (typeof window !== 'undefined') {
  initializeRegistry()
}
