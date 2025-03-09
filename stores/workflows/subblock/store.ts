import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '../registry/store'

// Create a localStorage key for the subblock store
const STORAGE_KEY = 'subblock-store'

interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, any>>> // Store values per workflow ID
}

interface SubBlockStore extends SubBlockState {
  setValue: (blockId: string, subBlockId: string, value: any) => void
  getValue: (blockId: string, subBlockId: string) => any
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => void
  loadSubblockValues: (workflowId: string, blocks: Record<string, any>) => void
}

export const useSubBlockStore = create<SubBlockStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        workflowValues: {},

        // Set a subblock value for the active workflow
        setValue: (blockId: string, subBlockId: string, value: any) => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) return

          set((state) => {
            // Create a deep copy of the current state
            const newWorkflowValues = { ...state.workflowValues }

            // Initialize nested objects if they don't exist
            if (!newWorkflowValues[activeWorkflowId]) {
              newWorkflowValues[activeWorkflowId] = {}
            }

            if (!newWorkflowValues[activeWorkflowId][blockId]) {
              newWorkflowValues[activeWorkflowId][blockId] = {}
            }

            // Set the value
            newWorkflowValues[activeWorkflowId][blockId][subBlockId] = value

            return { workflowValues: newWorkflowValues }
          })
        },

        // Get a subblock value for the active workflow
        getValue: (blockId: string, subBlockId: string) => {
          const state = get()
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

          if (!activeWorkflowId) return undefined

          return state.workflowValues[activeWorkflowId]?.[blockId]?.[subBlockId]
        },

        // Clear all subblock values
        clear: () => {
          set({ workflowValues: {} })
        },

        // Initialize subblock values from a workflow
        initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
          if (!workflowId) return

          try {
            // Extract subblock values from the workflow blocks
            const subblockValues: Record<string, Record<string, any>> = {}

            // Process each block to extract subblock values
            Object.entries(blocks).forEach(([blockId, block]) => {
              if (block.subBlocks) {
                subblockValues[blockId] = {}

                // Extract values from each subblock
                Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
                  if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
                    subblockValues[blockId][subBlockId] = subBlock.value
                  }
                })
              }
            })

            set((state) => {
              // Create a deep copy of the current state
              const newWorkflowValues = { ...state.workflowValues }

              // Set the values for this workflow
              newWorkflowValues[workflowId] = subblockValues

              return { workflowValues: newWorkflowValues }
            })
          } catch (error) {
            console.error('Error initializing subblock values:', error)
          }
        },

        // Load subblock values from a workflow
        loadSubblockValues: (workflowId: string, blocks: Record<string, any>) => {
          if (!workflowId) return

          try {
            // Extract subblock values from the workflow blocks
            const subblockValues: Record<string, Record<string, any>> = {}

            // Process each block to extract subblock values
            Object.entries(blocks).forEach(([blockId, block]) => {
              if (block.subBlocks) {
                subblockValues[blockId] = {}

                // Extract values from each subblock
                Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
                  if (subBlock && typeof subBlock === 'object' && 'value' in subBlock) {
                    subblockValues[blockId][subBlockId] = subBlock.value
                  }
                })
              }
            })

            set((state) => {
              // Create a deep copy of the current state
              const newWorkflowValues = { ...state.workflowValues }

              // Set the values for this workflow
              newWorkflowValues[workflowId] = subblockValues

              return { workflowValues: newWorkflowValues }
            })
          } catch (error) {
            console.error('Error loading subblock values:', error)
          }
        },
      }),
      {
        name: STORAGE_KEY,
        // Only persist the workflowValues
        partialize: (state) => ({ workflowValues: state.workflowValues }),
      }
    ),
    { name: 'subblock-store' }
  )
)
