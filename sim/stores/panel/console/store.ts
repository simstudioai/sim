import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { ConsoleEntry, ConsoleStore } from './types'
import { useChatStore } from '../chat/store'

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
    if (
      key.toLowerCase() === 'apikey' ||
      key.toLowerCase() === 'api_key' ||
      key.toLowerCase() === 'access_token'
    ) {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Gets a nested property value from an object using a path string
 * @param obj The object to get the value from
 * @param path The path to the value (e.g. 'response.content')
 * @returns The value at the path, or undefined if not found
 */
const getValueByPath = (obj: any, path: string): any => {
  if (!obj || !path) return undefined
  
  const pathParts = path.split('.')
  let current = obj
  
  for (const part of pathParts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = current[part]
  }
  
  return current
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

            // Check if this block matches a selected workflow output
            if (entry.workflowId && entry.blockName) {
              const chatStore = useChatStore.getState()
              const selectedOutputIds = chatStore.getSelectedWorkflowOutput(entry.workflowId)
              
              if (selectedOutputIds && selectedOutputIds.length > 0) {
                // Process each selected output that matches this block
                for (const selectedOutputId of selectedOutputIds) {
                  // The selectedOutputId format is "{blockId}_{path}"
                  // We need to extract both components
                  const idParts = selectedOutputId.split('_')
                  const selectedBlockId = idParts[0]
                  // Reconstruct the path by removing the blockId part
                  const selectedPath = idParts.slice(1).join('.')
                  
                  // If this block matches the selected output for this workflow
                  if (selectedBlockId && entry.blockId === selectedBlockId) {
                    // Extract the specific value from the output using the path
                    let specificValue: any = undefined
                    
                    if (selectedPath) {
                      specificValue = getValueByPath(entry.output, selectedPath)                    
                    } else {
                      specificValue = entry.output
                    }
                    
                    // Format the value appropriately for display
                    let formattedValue: string
                    if (specificValue === undefined) {
                      formattedValue = "Output value not found"
                    } else if (typeof specificValue === 'object') {
                      formattedValue = JSON.stringify(specificValue, null, 2)
                    } else {
                      formattedValue = String(specificValue)
                    }
                    
                    // Add the specific value to chat, not the whole output
                    chatStore.addMessage({
                      content: formattedValue,
                      workflowId: entry.workflowId,
                      type: 'workflow',
                      blockId: entry.blockId,
                    })
                  }
                }
              }
            }

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
