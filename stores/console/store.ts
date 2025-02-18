import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { ConsoleEntry, ConsoleStore } from './types'

// MAX across all workflows
const MAX_ENTRIES = 50

export const useConsoleStore = create<ConsoleStore>()(
  devtools(
    persist(
      (set, get) => ({
        entries: [],
        isOpen: false,

        addConsole: (entry) => {
          set((state) => {
            const newEntry: ConsoleEntry = {
              ...entry,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
            }

            // Keep only the last MAX_ENTRIES
            const newEntries = [newEntry, ...state.entries].slice(0, MAX_ENTRIES)

            return { entries: newEntries }
          })
        },

        clearConsole: (workflowId: string | null) => {
          set((state) => ({
            entries: state.entries.filter(
              (entry) => !workflowId || entry.workflowId !== workflowId
            ),
          }))
        },

        getWorkflowEntries: (workflowId) => {
          return get().entries.filter((entry) => entry.workflowId === workflowId)
        },

        toggleConsole: () => {
          set((state) => ({ isOpen: !state.isOpen }))
        },
      }),
      {
        name: 'console-store',
      }
    )
  )
)
