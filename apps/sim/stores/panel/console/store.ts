import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { redactApiKeys } from '@/lib/utils'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { ConsoleEntry, ConsoleStore } from './types'

const MAX_ENTRIES = 50 // MAX across all workflows
const MAX_IMAGE_DATA_SIZE = 1000 // Maximum size of image data to store (in characters)

/**
 * Safely clone and update a NormalizedBlockOutput
 */
const updateBlockOutput = (
  existingOutput: NormalizedBlockOutput | undefined,
  contentUpdate: string
): NormalizedBlockOutput => {
  const baseOutput = existingOutput || {}

  return {
    ...baseOutput,
    content: contentUpdate,
  }
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

            return { entries: newEntries }
          })

          // Return the created entry by finding it in the updated store
          return get().entries[0]
        },

        clearConsole: (workflowId: string | null) => {
          set((state) => ({
            entries: workflowId
              ? state.entries.filter((entry) => entry.workflowId !== workflowId)
              : [],
          }))
        },

        exportConsoleCSV: (workflowId: string) => {
          const entries = get().entries.filter((entry) => entry.workflowId === workflowId)

          if (entries.length === 0) {
            return
          }

          // Helper function to safely stringify and escape CSV values
          const formatCSVValue = (value: any): string => {
            if (value === null || value === undefined) {
              return ''
            }

            let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

            // Truncate very long strings
            if (stringValue.length > 1000) {
              stringValue = `${stringValue.substring(0, 1000)}...`
            }

            // Escape quotes and wrap in quotes if contains special characters
            if (
              stringValue.includes('"') ||
              stringValue.includes(',') ||
              stringValue.includes('\n')
            ) {
              stringValue = `"${stringValue.replace(/"/g, '""')}"`
            }

            return stringValue
          }

          // CSV Headers
          const headers = [
            'timestamp',
            'blockName',
            'blockType',
            'startedAt',
            'endedAt',
            'durationMs',
            'success',
            'input',
            'output',
            'error',
            'warning',
          ]

          // Generate CSV rows
          const csvRows = [
            headers.join(','),
            ...entries.map((entry) =>
              [
                formatCSVValue(entry.timestamp),
                formatCSVValue(entry.blockName),
                formatCSVValue(entry.blockType),
                formatCSVValue(entry.startedAt),
                formatCSVValue(entry.endedAt),
                formatCSVValue(entry.durationMs),
                formatCSVValue(entry.success),
                formatCSVValue(entry.input),
                formatCSVValue(entry.output),
                formatCSVValue(entry.error),
                formatCSVValue(entry.warning),
              ].join(',')
            ),
          ]

          // Create CSV content
          const csvContent = csvRows.join('\n')

          // Generate filename with timestamp
          const now = new Date()
          const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const filename = `console-${workflowId}-${timestamp}.csv`

          // Create and trigger download
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
          const link = document.createElement('a')

          if (link.download !== undefined) {
            const url = URL.createObjectURL(blob)
            link.setAttribute('href', url)
            link.setAttribute('download', filename)
            link.style.visibility = 'hidden'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }
        },

        getWorkflowEntries: (workflowId) => {
          return get().entries.filter((entry) => entry.workflowId === workflowId)
        },

        toggleConsole: () => {
          set((state) => ({ isOpen: !state.isOpen }))
        },

        updateConsole: (
          blockId: string,
          update: string | import('./types').ConsoleUpdate,
          executionId?: string
        ) => {
          set((state) => {
            const updatedEntries = state.entries.map((entry) => {
              // Only update if both blockId and executionId match
              const isMatch = entry.blockId === blockId && entry.executionId === executionId
              if (isMatch) {
                if (typeof update === 'string') {
                  // Simple content update for backward compatibility
                  const newOutput = updateBlockOutput(entry.output, update)
                  return { ...entry, output: newOutput }
                }
                // Complex update with multiple fields
                const updatedEntry = { ...entry }

                if (update.content !== undefined) {
                  const newOutput = updateBlockOutput(entry.output, update.content)
                  updatedEntry.output = newOutput
                }

                if (update.replaceOutput !== undefined) {
                  // Complete replacement of output
                  updatedEntry.output = update.replaceOutput
                } else if (update.output !== undefined) {
                  const existingOutput = entry.output || {}
                  updatedEntry.output = {
                    ...existingOutput,
                    ...update.output,
                  }
                }

                if (update.error !== undefined) {
                  updatedEntry.error = update.error
                }

                if (update.warning !== undefined) {
                  updatedEntry.warning = update.warning
                }

                if (update.success !== undefined) {
                  updatedEntry.success = update.success
                }

                if (update.endedAt !== undefined) {
                  updatedEntry.endedAt = update.endedAt
                }

                if (update.durationMs !== undefined) {
                  updatedEntry.durationMs = update.durationMs
                }

                if (update.input !== undefined) {
                  updatedEntry.input = update.input
                }

                return updatedEntry
              }
              return entry
            })
            return { ...state, entries: updatedEntries }
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
