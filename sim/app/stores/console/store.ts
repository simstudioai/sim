import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { ConsoleEntry, ConsoleStore } from './types'

// MAX across all workflows
const MAX_ENTRIES = 50

/**
 * Recursively redacts API keys in an object
 * @param obj The object to redact API keys from
 * @returns A new object with API keys redacted
 */
const redactApiKeys = (obj: any): any => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(redactApiKeys)
  }

  const result: Record<string, any> = {}
  
  for (const [key, value] of Object.entries(obj)) {
    // Check if the key is 'apiKey' (case insensitive)
    if (key.toLowerCase() === 'apikey' || key.toLowerCase() === 'api_key' || key.toLowerCase() === 'access_token') {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }
  
  return result
}

export const useConsoleStore = create<ConsoleStore>()(
  devtools(
    persist(
      (set, get) => ({
        entries: [],
        isOpen: false,

        addConsole: (entry) => {
          set((state) => {
            // Create a new entry with redacted API keys
            const redactedEntry = { ...entry }
            
            // If the entry has output and it's an object, redact API keys
            if (redactedEntry.output && typeof redactedEntry.output === 'object') {
              redactedEntry.output = redactApiKeys(redactedEntry.output)
            }
            
            const newEntry: ConsoleEntry = {
              ...redactedEntry,
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
