import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { SubBlockConfig } from '@/blocks/types'
import { loadSubblockValues, saveSubblockValues } from '../persistence'
import { useWorkflowRegistry } from '../registry/store'
import { workflowSync } from '../sync'
import { SubBlockStore } from './types'

// Add debounce utility for syncing
let syncDebounceTimer: NodeJS.Timeout | null = null
const DEBOUNCE_DELAY = 500 // 500ms delay for sync

/**
 * SubBlockState stores values for all subblocks in workflows
 *
 * Important implementation notes:
 * 1. Values are stored per workflow, per block, per subblock
 * 2. When workflows are synced to the database, the mergeSubblockState function
 *    in utils.ts combines the block structure with these values
 * 3. If a subblock value exists here but not in the block structure
 *    (e.g., inputFormat in starter block), the merge function will include it
 *    in the synchronized state to ensure persistence
 */

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
          const currentValues = get().workflowValues[activeWorkflowId] || {}
          saveSubblockValues(activeWorkflowId, currentValues)

          // Trigger debounced sync to DB
          get().syncWithDB()
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

          saveSubblockValues(activeWorkflowId, {})

          // Trigger sync to DB immediately on clear
          workflowSync.sync()
        },

        initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
          // First, try to load from localStorage
          const savedValues = loadSubblockValues(workflowId)

          if (savedValues) {
            set((state) => ({
              workflowValues: {
                ...state.workflowValues,
                [workflowId]: savedValues,
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
          saveSubblockValues(workflowId, values)
        },

        // Debounced sync function to trigger DB sync
        syncWithDB: () => {
          // Clear any existing timeout
          if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer)
          }

          // Set new timeout
          syncDebounceTimer = setTimeout(() => {
            // Trigger workflow sync to DB
            workflowSync.sync()
          }, DEBOUNCE_DELAY)
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
