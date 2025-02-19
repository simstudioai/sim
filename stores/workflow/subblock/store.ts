import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '../registry/store'

interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, any>>> // Store values per workflow ID
}

interface SubBlockStore extends SubBlockState {
  setValue: (blockId: string, subBlockId: string, value: any) => void
  getValue: (blockId: string, subBlockId: string) => any
  clear: () => void
  initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => void
}

export const useSubBlockStore = create<SubBlockStore>()(
  devtools(
    persist(
      (set, get) => ({
        workflowValues: {},

        setValue: (blockId: string, subBlockId: string, value: any) => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) return

          set((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: {
                ...state.workflowValues[activeWorkflowId],
                [blockId]: {
                  ...state.workflowValues[activeWorkflowId]?.[blockId],
                  [subBlockId]: value,
                },
              },
            },
          }))

          // Persist to localStorage for backup
          const storageKey = `subblock-values-${activeWorkflowId}`
          const currentValues = get().workflowValues[activeWorkflowId] || {}
          localStorage.setItem(storageKey, JSON.stringify(currentValues))
        },

        getValue: (blockId: string, subBlockId: string) => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) return null

          return get().workflowValues[activeWorkflowId]?.[blockId]?.[subBlockId] ?? null
        },

        clear: () => {
          const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
          if (!activeWorkflowId) return

          set((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId]: {},
            },
          }))

          localStorage.removeItem(`subblock-values-${activeWorkflowId}`)
        },

        initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
          // First, try to load from localStorage
          const storageKey = `subblock-values-${workflowId}`
          const savedValues = localStorage.getItem(storageKey)

          if (savedValues) {
            const parsedValues = JSON.parse(savedValues)
            set((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [workflowId]: parsedValues,
              },
            }))
            return
          }

          // If no saved values, initialize from blocks
          const values: Record<string, Record<string, any>> = {}
          Object.entries(blocks).forEach(([blockId, block]) => {
            values[blockId] = {}
            Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
              values[blockId][subBlockId] = (subBlock as SubBlockConfig).value
            })
          })

          set((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [workflowId]: values,
            },
          }))

          // Save to localStorage
          localStorage.setItem(storageKey, JSON.stringify(values))
        },
      }),
      {
        name: 'subblock-store',
        partialize: (state) => ({ workflowValues: state.workflowValues }),
        // Use default storage
        storage: {
          getItem: (name) => {
            const value = localStorage.getItem(name)
            return value ? JSON.parse(value) : null
          },
          setItem: (name, value) => {
            localStorage.setItem(name, JSON.stringify(value))
          },
          removeItem: (name) => {
            localStorage.removeItem(name)
          },
        },
      }
    ),
    { name: 'subblock-store' }
  )
)
