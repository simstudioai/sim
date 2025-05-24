import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { redactApiKeys } from '@/lib/utils'
import { useChatStore } from '../chat/store'
import type { ConsoleEntry, ConsoleStore } from './types'

const MAX_ENTRIES = 50 // MAX across all workflows
const MAX_IMAGE_DATA_SIZE = 1000 // Maximum size of image data to store (in characters)

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

/**
 * Checks if a string is likely a base64 encoded image or large data blob
 */
const isLikelyBase64Data = (value: string): boolean => {
  if (value.length < 100) return false
  return value.startsWith('data:image') || /^[A-Za-z0-9+/=]{1000,}$/.test(value)
}

/**
 * Processes an object to handle large strings (like base64 image data)
 * for localStorage to prevent quota issues
 */
const processSafeStorage = (obj: any): any => {
  if (!obj) return obj

  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map((item) => processSafeStorage(item))
  }

  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (
      (key === 'image' || key.includes('image')) &&
      typeof value === 'string' &&
      value.length > MAX_IMAGE_DATA_SIZE
    ) {
      if (value.startsWith('data:image')) {
        const mimeEnd = value.indexOf(',')
        result[key] =
          mimeEnd > 0
            ? `${value.substring(0, mimeEnd + 1)}[Image data removed, original length: ${value.length}]`
            : `[Image data removed, original length: ${value.length}]`
      } else {
        result[key] = `[Image data removed, original length: ${value.length}]`
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = processSafeStorage(value)
    } else if (
      typeof value === 'string' &&
      value.length > MAX_IMAGE_DATA_SIZE &&
      isLikelyBase64Data(value)
    ) {
      if (value.startsWith('data:image')) {
        const mimeEnd = value.indexOf(',')
        result[key] =
          mimeEnd > 0
            ? `${value.substring(0, mimeEnd + 1)}[Large data removed, original length: ${value.length}]`
            : `[Large data removed, original length: ${value.length}]`
      } else {
        result[key] = `[Large data removed, original length: ${value.length}]`
      }
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

        addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => {
          set((state) => {
            // Determine early if this entry represents a streaming output
            const isStreamingOutput =
              (typeof ReadableStream !== 'undefined' && entry.output instanceof ReadableStream) ||
              (typeof entry.output === 'object' &&
                entry.output &&
                entry.output.isStreaming === true) ||
              (typeof entry.output === 'object' &&
                entry.output &&
                'executionData' in entry.output &&
                typeof entry.output.executionData === 'object' &&
                entry.output.executionData?.isStreaming === true) ||
              (typeof entry.output === 'object' && entry.output && 'stream' in entry.output) ||
              (typeof entry.output === 'object' &&
                entry.output &&
                'stream' in entry.output &&
                'execution' in entry.output)

            // Skip adding raw streaming objects that have both stream and executionData
            if (
              typeof entry.output === 'object' &&
              entry.output &&
              'stream' in entry.output &&
              'executionData' in entry.output
            ) {
              // Don't add this entry - it will be processed by our explicit formatting code in executor/index.ts
              return { entries: state.entries }
            }

            // Also skip raw StreamingExecution objects (with stream and execution properties)
            if (
              typeof entry.output === 'object' &&
              entry.output &&
              'stream' in entry.output &&
              'execution' in entry.output
            ) {
              // Don't add this entry to prevent duplicate console entries for streaming responses
              return { entries: state.entries }
            }

            // Create a new entry with redacted API keys (if not a stream)
            const redactedEntry = { ...entry }

            // If output is a stream, we skip redaction (it's not an object we want to recurse into)
            if (
              !isStreamingOutput &&
              redactedEntry.output &&
              typeof redactedEntry.output === 'object'
            ) {
              redactedEntry.output = redactApiKeys(redactedEntry.output)
            }

            // Create the new entry with ID and timestamp
            const newEntry = {
              ...redactedEntry,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
            }

            // Keep only the last MAX_ENTRIES
            const newEntries = [newEntry, ...state.entries].slice(0, MAX_ENTRIES)

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
                    let specificValue: any

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
                    }
                    if (specificValue === undefined) {
                      formattedValue = 'Output value not found'
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

        updateConsole: (
          entryId: string,
          updatedData: Partial<Omit<ConsoleEntry, 'id' | 'timestamp'>>
        ) => {
          set((state) => {
            const updatedEntries = state.entries.map((entry) => {
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
        partialize: (state) => {
          const sanitizedEntries = state.entries.slice(0, MAX_ENTRIES).map((entry) => ({
            ...entry,
            output: processSafeStorage(entry.output),
          }))

          return {
            isOpen: state.isOpen,
            entries: sanitizedEntries,
          }
        },
      }
    )
  )
)
