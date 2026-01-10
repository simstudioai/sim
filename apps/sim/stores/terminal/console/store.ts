import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { redactApiKeys } from '@/lib/core/security/redaction'
import type { NormalizedBlockOutput } from '@/executor/types'
import { useExecutionStore } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { useGeneralStore } from '@/stores/settings/general'
import type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from '@/stores/terminal/console/types'

const logger = createLogger('TerminalConsoleStore')

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

  if ('stream' in output && 'executionData' in output) {
    return true
  }

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
            if (shouldSkipEntry(entry.output)) {
              return { entries: state.entries }
            }

            const redactedEntry = { ...entry }
            if (
              !isStreamingOutput(entry.output) &&
              redactedEntry.output &&
              typeof redactedEntry.output === 'object'
            ) {
              redactedEntry.output = redactApiKeys(redactedEntry.output)
            }
            if (redactedEntry.input && typeof redactedEntry.input === 'object') {
              redactedEntry.input = redactApiKeys(redactedEntry.input)
            }

            const newEntry: ConsoleEntry = {
              ...redactedEntry,
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
            }

            return { entries: [newEntry, ...state.entries] }
          })

          const newEntry = get().entries[0]

          if (newEntry?.error) {
            const { isErrorNotificationsEnabled } = useGeneralStore.getState()

            if (isErrorNotificationsEnabled) {
              try {
                const errorMessage = String(newEntry.error)
                const blockName = newEntry.blockName || 'Unknown Block'

                const copilotMessage = `${errorMessage}\n\nError in ${blockName}.\n\nPlease fix this.`

                useNotificationStore.getState().addNotification({
                  level: 'error',
                  message: errorMessage,
                  workflowId: entry.workflowId,
                  action: {
                    type: 'copilot',
                    message: copilotMessage,
                  },
                })
              } catch (notificationError) {
                logger.error('Failed to create block error notification', {
                  entryId: newEntry.id,
                  error: notificationError,
                })
              }
            }
          }

          return newEntry
        },

        /**
         * Clears console entries for a specific workflow and clears the run path
         * @param workflowId - The workflow ID to clear entries for
         */
        clearWorkflowConsole: (workflowId: string) => {
          set((state) => ({
            entries: state.entries.filter((entry) => entry.workflowId !== workflowId),
          }))
          useExecutionStore.getState().clearRunPath()
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
              if (entry.blockId !== blockId || entry.executionId !== executionId) {
                return entry
              }

              if (typeof update === 'string') {
                const newOutput = updateBlockOutput(entry.output, update)
                return { ...entry, output: newOutput }
              }

              const updatedEntry = { ...entry }

              if (update.content !== undefined) {
                updatedEntry.output = updateBlockOutput(entry.output, update.content)
              }

              if (update.replaceOutput !== undefined) {
                updatedEntry.output =
                  typeof update.replaceOutput === 'object' && update.replaceOutput !== null
                    ? redactApiKeys(update.replaceOutput)
                    : update.replaceOutput
              } else if (update.output !== undefined) {
                const mergedOutput = {
                  ...(entry.output || {}),
                  ...update.output,
                }
                updatedEntry.output =
                  typeof mergedOutput === 'object' ? redactApiKeys(mergedOutput) : mergedOutput
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
                updatedEntry.input =
                  typeof update.input === 'object' && update.input !== null
                    ? redactApiKeys(update.input)
                    : update.input
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
