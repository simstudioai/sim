import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { redactApiKeys } from '@/lib/utils'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from './types'

/**
 * Updates a NormalizedBlockOutput with new content
 */
const updateBlockOutput = (
  existingOutput: NormalizedBlockOutput | undefined,
  contentUpdate: string
): NormalizedBlockOutput => {
  return {
    ...(existingOutput || {}),
    content: contentUpdate,
  }
}

/**
 * Checks if output represents a streaming object that should be skipped
 */
const isStreamingOutput = (output: any): boolean => {
  if (typeof ReadableStream !== 'undefined' && output instanceof ReadableStream) {
    return true
  }

  if (typeof output !== 'object' || !output) {
    return false
  }

  // Check for streaming indicators
  return (
    output.isStreaming === true ||
    ('executionData' in output &&
      typeof output.executionData === 'object' &&
      output.executionData?.isStreaming === true) ||
    'stream' in output
  )
}

/**
 * Checks if entry should be skipped to prevent duplicates
 */
const shouldSkipEntry = (output: any): boolean => {
  if (typeof output !== 'object' || !output) {
    return false
  }

  // Skip raw streaming objects with both stream and executionData
  if ('stream' in output && 'executionData' in output) {
    return true
  }

  // Skip raw StreamingExecution objects
  if ('stream' in output && 'execution' in output) {
    return true
  }

  return false
}

export const useTerminalConsoleStore = create<ConsoleStore>()(
  devtools(
    persist(
      (set, get) => ({
        entries: [],
        isOpen: false,

        addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => {
          set((state) => {
            // Skip duplicate streaming entries
            if (shouldSkipEntry(entry.output)) {
              return { entries: state.entries }
            }

            // Redact API keys from output
            const redactedEntry = { ...entry }
            if (
              !isStreamingOutput(entry.output) &&
              redactedEntry.output &&
              typeof redactedEntry.output === 'object'
            ) {
              redactedEntry.output = redactApiKeys(redactedEntry.output)
            }

            // Create new entry with ID and timestamp
            const newEntry: ConsoleEntry = {
              ...redactedEntry,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
            }

            return { entries: [newEntry, ...state.entries] }
          })

          return get().entries[0]
        },

        /**
         * Clears console entries for a specific workflow
         * @param workflowId - The workflow ID to clear entries for
         */
        clearWorkflowConsole: (workflowId: string) => {
          set((state) => ({
            entries: state.entries.filter((entry) => entry.workflowId !== workflowId),
          }))
        },

        /**
         * Clears all console entries or entries for a specific workflow
         * @param workflowId - The workflow ID to clear entries for, or null to clear all
         * @deprecated Use clearWorkflowConsole for clearing specific workflows
         */
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

          /**
           * Formats a value for CSV export
           */
          const formatCSVValue = (value: any): string => {
            if (value === null || value === undefined) {
              return ''
            }

            let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

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

          const csvContent = csvRows.join('\n')
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const filename = `terminal-console-${workflowId}-${timestamp}.csv`

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

        updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => {
          set((state) => {
            const updatedEntries = state.entries.map((entry) => {
              // Only update if both blockId and executionId match
              if (entry.blockId !== blockId || entry.executionId !== executionId) {
                return entry
              }

              // Handle simple string update
              if (typeof update === 'string') {
                const newOutput = updateBlockOutput(entry.output, update)
                return { ...entry, output: newOutput }
              }

              // Handle complex update
              const updatedEntry = { ...entry }

              if (update.content !== undefined) {
                updatedEntry.output = updateBlockOutput(entry.output, update.content)
              }

              if (update.replaceOutput !== undefined) {
                updatedEntry.output = update.replaceOutput
              } else if (update.output !== undefined) {
                updatedEntry.output = {
                  ...(entry.output || {}),
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
            })

            return { entries: updatedEntries }
          })
        },
      }),
      {
        name: 'terminal-console-store',
      }
    )
  )
)
