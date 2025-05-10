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

        addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => {
          set((state) => {
            // Determine early if this entry represents a streaming output
            const isStreamingOutput =
              (typeof ReadableStream !== 'undefined' && entry.output instanceof ReadableStream) ||
              (typeof entry.output === 'object' && entry.output && entry.output.isStreaming === true) ||
              (typeof entry.output === 'object' && entry.output && 'executionData' in entry.output &&
               typeof entry.output.executionData === 'object' && entry.output.executionData?.isStreaming === true) ||
              (typeof entry.output === 'object' && entry.output && 'stream' in entry.output) ||
              (typeof entry.output === 'object' && entry.output && 
               'stream' in entry.output && 'execution' in entry.output)

            // Skip adding raw streaming objects that have both stream and executionData
            if (typeof entry.output === 'object' && entry.output && 
                'stream' in entry.output && 'executionData' in entry.output) {
              // Don't add this entry - it will be processed by our explicit formatting code in executor/index.ts
              return { entries: state.entries }
            }

            // Also skip raw StreamingExecution objects (with stream and execution properties)
            if (typeof entry.output === 'object' && entry.output && 
                'stream' in entry.output && 'execution' in entry.output) {
              // Don't add this entry to prevent duplicate console entries for streaming responses
              return { entries: state.entries }
            }

            // Create a new entry with redacted API keys (if not a stream)
            const redactedEntry = { ...entry }

            // If output is a stream, we skip redaction (it's not an object we want to recurse into)
            if (!isStreamingOutput && redactedEntry.output && typeof redactedEntry.output === 'object') {
              redactedEntry.output = redactApiKeys(redactedEntry.output)
            }

            // Create the new entry with ID and timestamp
            const newEntry = { 
              ...redactedEntry, 
              id: crypto.randomUUID(), 
              timestamp: new Date().toISOString() 
            }

            // Keep only the last MAX_ENTRIES
            const newEntries = [
              newEntry,
              ...state.entries,
            ].slice(0, MAX_ENTRIES)

            // If the block produced a streaming output, skip automatic chat message creation
            if (isStreamingOutput) {
              return { entries: newEntries }
            }

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
                    // For streaming responses, use empty string and set isStreaming flag
                    if (isStreamingOutput) {
                      // Skip adding a message since we'll handle streaming in workflow execution
                      // This prevents the "Output value not found" message for streams
                      continue
                    } else if (specificValue === undefined) {
                      formattedValue = "Output value not found"
                    } else if (typeof specificValue === 'object') {
                      formattedValue = JSON.stringify(specificValue, null, 2)
                    } else {
                      formattedValue = String(specificValue)
                    }
                    
                    // Skip empty content messages (important for preventing empty entries)
                    if (!formattedValue || formattedValue.trim() === '') {
                      continue
                    }
                    
                    // Add the specific value to chat, not the whole output
                    chatStore.addMessage({
                      content: formattedValue,
                      workflowId: entry.workflowId,
                      type: 'workflow',
                      blockId: entry.blockId,
                      isStreaming: isStreamingOutput,
                    })
                  }
                }
              }
            }

            return { entries: newEntries }
          })
          
          // Return the created entry by finding it in the updated store
          return get().entries[0]
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

        updateConsole: (entryId: string, updatedData: Partial<Omit<ConsoleEntry, 'id' | 'timestamp'>>) => {
          set((state) => {
            const updatedEntries = state.entries.map(entry => {
              if (entry.id === entryId) {
                return {
                  ...entry,
                  ...updatedData,
                  output: updatedData.output ? redactApiKeys(updatedData.output) : entry.output,
                }
              }
              return entry
            })
            return { entries: updatedEntries }
          })
        },
      }),
      {
        name: 'console-store',
      }
    )
  )
)
