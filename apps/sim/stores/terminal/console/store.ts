import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { createJSONStorage, devtools, persist } from 'zustand/middleware'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { getQueryClient } from '@/app/_shell/providers/query-provider'
import type { NormalizedBlockOutput } from '@/executor/types'
import { type GeneralSettings, generalSettingsKeys } from '@/hooks/queries/general-settings'
import { useExecutionStore } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { indexedDBStorage } from '@/stores/terminal/console/storage'
import type { ConsoleEntry, ConsoleStore, ConsoleUpdate } from '@/stores/terminal/console/types'

const logger = createLogger('TerminalConsoleStore')

/**
 * Maximum number of console entries to keep per workflow.
 * Keeps the stored data size reasonable and improves performance.
 */
const MAX_ENTRIES_PER_WORKFLOW = 1000

const updateBlockOutput = (
  existingOutput: NormalizedBlockOutput | undefined,
  contentUpdate: string
): NormalizedBlockOutput => {
  return {
    ...(existingOutput || {}),
    content: contentUpdate,
  }
}

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
        _hasHydrated: false,

        setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

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

            const newEntries = [newEntry, ...state.entries]

            const executionsToRemove = new Set<string>()

            const workflowGroups = new Map<string, ConsoleEntry[]>()
            for (const e of newEntries) {
              const group = workflowGroups.get(e.workflowId) || []
              group.push(e)
              workflowGroups.set(e.workflowId, group)
            }

            for (const [workflowId, entries] of workflowGroups) {
              if (entries.length <= MAX_ENTRIES_PER_WORKFLOW) continue

              const execOrder: string[] = []
              const seen = new Set<string>()
              for (const e of entries) {
                const execId = e.executionId ?? e.id
                if (!seen.has(execId)) {
                  execOrder.push(execId)
                  seen.add(execId)
                }
              }

              const counts = new Map<string, number>()
              for (const e of entries) {
                const execId = e.executionId ?? e.id
                counts.set(execId, (counts.get(execId) || 0) + 1)
              }

              let total = 0
              const toKeep = new Set<string>()
              for (const execId of execOrder) {
                const c = counts.get(execId) || 0
                if (total + c <= MAX_ENTRIES_PER_WORKFLOW) {
                  toKeep.add(execId)
                  total += c
                }
              }

              for (const execId of execOrder) {
                if (!toKeep.has(execId)) {
                  executionsToRemove.add(`${workflowId}:${execId}`)
                }
              }
            }

            const trimmedEntries = newEntries.filter((e) => {
              const key = `${e.workflowId}:${e.executionId ?? e.id}`
              return !executionsToRemove.has(key)
            })

            return { entries: trimmedEntries }
          })

          const newEntry = get().entries[0]

          if (newEntry?.error) {
            const settings = getQueryClient().getQueryData<GeneralSettings>(
              generalSettingsKeys.settings()
            )
            const isErrorNotificationsEnabled = settings?.errorNotificationsEnabled ?? true

            if (isErrorNotificationsEnabled) {
              try {
                const errorMessage = String(newEntry.error)
                const blockName = newEntry.blockName || 'Unknown Block'
                const displayMessage = `${blockName}: ${errorMessage}`

                const copilotMessage = `${errorMessage}\n\nError in ${blockName}.\n\nPlease fix this.`

                useNotificationStore.getState().addNotification({
                  level: 'error',
                  message: displayMessage,
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

              if (
                typeof update === 'object' &&
                update.iterationCurrent !== undefined &&
                entry.iterationCurrent !== update.iterationCurrent
              ) {
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

              if (update.startedAt !== undefined) {
                updatedEntry.startedAt = update.startedAt
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

              if (update.isRunning !== undefined) {
                updatedEntry.isRunning = update.isRunning
              }

              if (update.isCanceled !== undefined) {
                updatedEntry.isCanceled = update.isCanceled
              }

              if (update.iterationCurrent !== undefined) {
                updatedEntry.iterationCurrent = update.iterationCurrent
              }

              if (update.iterationTotal !== undefined) {
                updatedEntry.iterationTotal = update.iterationTotal
              }

              if (update.iterationType !== undefined) {
                updatedEntry.iterationType = update.iterationType
              }

              return updatedEntry
            })

            return { entries: updatedEntries }
          })
        },

        cancelRunningEntries: (workflowId: string) => {
          set((state) => {
            const now = new Date()
            const updatedEntries = state.entries.map((entry) => {
              if (entry.workflowId === workflowId && entry.isRunning) {
                const durationMs = entry.startedAt
                  ? now.getTime() - new Date(entry.startedAt).getTime()
                  : entry.durationMs
                return {
                  ...entry,
                  isRunning: false,
                  isCanceled: true,
                  endedAt: now.toISOString(),
                  durationMs,
                }
              }
              return entry
            })
            return { entries: updatedEntries }
          })
        },
      }),
      {
        name: 'terminal-console-store',
        storage: createJSONStorage(() => indexedDBStorage),
        partialize: (state) => ({
          entries: state.entries,
          isOpen: state.isOpen,
        }),
        onRehydrateStorage: () => (_state, error) => {
          if (error) {
            logger.error('Failed to rehydrate console store', { error })
          }
        },
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<ConsoleStore> | undefined
          const entries = (persisted?.entries ?? currentState.entries).map((entry, index) => {
            if (entry.executionOrder === undefined) {
              return { ...entry, executionOrder: index + 1 }
            }
            return entry
          })
          return {
            ...currentState,
            entries,
            isOpen: persisted?.isOpen ?? currentState.isOpen,
          }
        },
      }
    )
  )
)

if (typeof window !== 'undefined') {
  useTerminalConsoleStore.persist.onFinishHydration(() => {
    useTerminalConsoleStore.setState({ _hasHydrated: true })
  })

  if (useTerminalConsoleStore.persist.hasHydrated()) {
    useTerminalConsoleStore.setState({ _hasHydrated: true })
  }
}
