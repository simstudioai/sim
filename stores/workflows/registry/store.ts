import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { useSubBlockStore } from '../subblock/store'
import { generateUniqueName, getNextWorkflowColor } from '../utils'
import { useWorkflowStore } from '../workflow/store'
import { WorkflowMetadata, WorkflowRegistry } from './types'

// Create a localStorage key for the registry
const STORAGE_KEY = 'workflow-registry'

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    persist(
      (set, get) => ({
        // Store state
        workflows: {},
        activeWorkflowId: null,

        // Set active workflow
        setActiveWorkflow: (id: string) => {
          const { workflows } = get()

          if (!workflows[id]) {
            console.error(`Workflow ${id} not found`)
            return
          }

          // Save current workflow state before switching
          const currentId = get().activeWorkflowId

          try {
            // Set the new active workflow
            set({ activeWorkflowId: id })

            console.log(`Active workflow set to ${id}`)
          } catch (error) {
            console.error('Error setting active workflow:', error)
          }
        },

        // Remove a workflow
        removeWorkflow: (id: string) => {
          const { workflows, activeWorkflowId } = get()

          try {
            // Create a copy of the workflows without the one to remove
            const updatedWorkflows = { ...workflows }
            delete updatedWorkflows[id]

            // Update the store
            set({ workflows: updatedWorkflows })

            // If the removed workflow was active, set a new active workflow
            if (activeWorkflowId === id) {
              const newActiveId = Object.keys(updatedWorkflows)[0] || null
              set({ activeWorkflowId: newActiveId })
            }

            console.log(`Workflow ${id} removed`)
            return
          } catch (error) {
            console.error(`Error removing workflow ${id}:`, error)
          }
        },

        // Update workflow metadata
        updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => {
          const { workflows } = get()

          try {
            // Get the current workflow metadata
            const currentWorkflow = workflows[id]

            if (!currentWorkflow) {
              console.error(`Workflow ${id} not found`)
              return
            }

            // Update the workflow with new metadata
            const updatedWorkflow = {
              ...currentWorkflow,
              ...metadata,
              lastModified: new Date(),
            }

            // Update the store
            set((state) => ({
              workflows: {
                ...state.workflows,
                [id]: updatedWorkflow,
              },
            }))

            console.log(`Workflow ${id} metadata updated`)
          } catch (error) {
            console.error(`Error updating workflow ${id}:`, error)
          }
        },

        // Create a new workflow
        createWorkflow: (options = {}) => {
          try {
            // Generate a unique ID for the new workflow
            const id = crypto.randomUUID()

            // Create the workflow metadata
            const newWorkflow: WorkflowMetadata = {
              id,
              name: generateUniqueName(get().workflows),
              color: getNextWorkflowColor(get().workflows),
            }

            // Update the store
            set((state) => ({
              workflows: {
                ...state.workflows,
                [id]: newWorkflow,
              },
              activeWorkflowId: options.isInitial ? id : state.activeWorkflowId,
            }))

            console.log(`Workflow ${id} created`)
            return id
          } catch (error) {
            console.error('Error creating workflow:', error)
            return ''
          }
        },
      }),
      {
        name: STORAGE_KEY,
        // Only persist these fields
        partialize: (state) => ({
          workflows: state.workflows,
          activeWorkflowId: state.activeWorkflowId,
        }),
      }
    ),
    { name: 'workflow-registry' }
  )
)
