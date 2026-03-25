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
import {
  normalizeConsoleError,
  normalizeConsoleInput,
  normalizeConsoleOutput,
  safeConsoleStringify,
  trimConsoleEntries,
} from '@/stores/terminal/console/utils'

const logger = createLogger('TerminalConsoleStore')

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

const matchesEntryForUpdate = (
  entry: ConsoleEntry,
  blockId: string,
  executionId: string | undefined,
  update: string | ConsoleUpdate
): boolean => {
  if (entry.blockId !== blockId || entry.executionId !== executionId) {
    return false
  }

  if (typeof update !== 'object') {
    return true
  }

  if (update.executionOrder !== undefined && entry.executionOrder !== update.executionOrder) {
    return false
  }

  if (update.iterationCurrent !== undefined && entry.iterationCurrent !== update.iterationCurrent) {
    return false
  }

  if (
    update.iterationContainerId !== undefined &&
    entry.iterationContainerId !== update.iterationContainerId
  ) {
    return false
  }

  if (
    update.childWorkflowBlockId !== undefined &&
    entry.childWorkflowBlockId !== update.childWorkflowBlockId
  ) {
    return false
  }

  return true
}

interface NotifyBlockErrorParams {
  error: unknown
  blockName: string
  workflowId?: string
  logContext: Record<string, unknown>
}

/**
 * Sends an error notification for a block failure if error notifications are enabled.
 */
const notifyBlockError = ({ error, blockName, workflowId, logContext }: NotifyBlockErrorParams) => {
  const settings = getQueryClient().getQueryData<GeneralSettings>(generalSettingsKeys.settings())
  const isErrorNotificationsEnabled = settings?.errorNotificationsEnabled ?? true

  if (!isErrorNotificationsEnabled) return

  try {
    const errorMessage = String(error)
    const displayName = blockName || 'Unknown Block'
    const displayMessage = `${displayName}: ${errorMessage}`
    const copilotMessage = `${errorMessage}\n\nError in ${displayName}.\n\nPlease fix this.`

    useNotificationStore.getState().addNotification({
      level: 'error',
      message: displayMessage,
      workflowId,
      action: {
        type: 'copilot',
        message: copilotMessage,
      },
    })
  } catch (notificationError) {
    logger.error('Failed to create block error notification', {
      ...logContext,
      error: notificationError,
    })
  }
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
          if (shouldSkipEntry(entry.output)) {
            return get().entries[0] as ConsoleEntry
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

          const createdEntry: ConsoleEntry = {
            ...redactedEntry,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            input: normalizeConsoleInput(redactedEntry.input),
            output: normalizeConsoleOutput(redactedEntry.output),
            error: normalizeConsoleError(redactedEntry.error),
            warning:
              typeof redactedEntry.warning === 'string'
                ? (normalizeConsoleError(redactedEntry.warning) ?? undefined)
                : redactedEntry.warning,
          }

          set((state) => {
            return { entries: trimConsoleEntries([createdEntry, ...state.entries]) }
          })

          if (createdEntry.error && createdEntry.blockType !== 'cancelled') {
            notifyBlockError({
              error: createdEntry.error,
              blockName: createdEntry.blockName || 'Unknown Block',
              workflowId: entry.workflowId,
              logContext: { entryId: createdEntry.id },
            })
          }

          return createdEntry
        },

        clearWorkflowConsole: (workflowId: string) => {
          set((state) => ({
            entries: state.entries.filter((entry) => entry.workflowId !== workflowId),
          }))
          useExecutionStore.getState().clearRunPath(workflowId)
        },

        clearExecutionEntries: (executionId: string) =>
          set((state) => ({
            entries: state.entries.filter((e) => e.executionId !== executionId),
          })),

        exportConsoleCSV: (workflowId: string) => {
          const entries = get().entries.filter((entry) => entry.workflowId === workflowId)

          if (entries.length === 0) {
            return
          }

          const formatCSVValue = (value: any): string => {
            if (value === null || value === undefined) {
              return ''
            }

            let stringValue =
              typeof value === 'object' ? safeConsoleStringify(value) : String(value)

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
              if (!matchesEntryForUpdate(entry, blockId, executionId, update)) {
                return entry
              }

              if (typeof update === 'string') {
                const newOutput = normalizeConsoleOutput(updateBlockOutput(entry.output, update))
                return { ...entry, output: newOutput }
              }

              const updatedEntry = { ...entry }

              if (update.content !== undefined) {
                updatedEntry.output = normalizeConsoleOutput(
                  updateBlockOutput(entry.output, update.content)
                )
              }

              if (update.replaceOutput !== undefined) {
                const redactedOutput =
                  typeof update.replaceOutput === 'object' && update.replaceOutput !== null
                    ? redactApiKeys(update.replaceOutput)
                    : update.replaceOutput
                updatedEntry.output = normalizeConsoleOutput(redactedOutput)
              } else if (update.output !== undefined) {
                const mergedOutput = {
                  ...(entry.output || {}),
                  ...update.output,
                }
                updatedEntry.output =
                  typeof mergedOutput === 'object'
                    ? normalizeConsoleOutput(redactApiKeys(mergedOutput))
                    : normalizeConsoleOutput(mergedOutput)
              }

              if (update.error !== undefined) {
                updatedEntry.error = normalizeConsoleError(update.error)
              }

              if (update.warning !== undefined) {
                updatedEntry.warning = normalizeConsoleError(update.warning) ?? undefined
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
                    ? normalizeConsoleInput(redactApiKeys(update.input))
                    : normalizeConsoleInput(update.input)
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

              if (update.iterationContainerId !== undefined) {
                updatedEntry.iterationContainerId = update.iterationContainerId
              }

              if (update.parentIterations !== undefined) {
                updatedEntry.parentIterations = update.parentIterations
              }

              if (update.childWorkflowBlockId !== undefined) {
                updatedEntry.childWorkflowBlockId = update.childWorkflowBlockId
              }

              if (update.childWorkflowName !== undefined) {
                updatedEntry.childWorkflowName = update.childWorkflowName
              }

              if (update.childWorkflowInstanceId !== undefined) {
                updatedEntry.childWorkflowInstanceId = update.childWorkflowInstanceId
              }

              return updatedEntry
            })

            return { entries: trimConsoleEntries(updatedEntries) }
          })

          if (typeof update === 'object' && update.error) {
            const matchingEntry = get().entries.find(
              (e) => e.blockId === blockId && e.executionId === executionId
            )
            notifyBlockError({
              error: update.error,
              blockName: matchingEntry?.blockName || 'Unknown Block',
              workflowId: matchingEntry?.workflowId,
              logContext: { blockId },
            })
          }
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
            return { entries: trimConsoleEntries(updatedEntries) }
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
          const rawEntries = persisted?.entries ?? currentState.entries
          const oneHourAgo = Date.now() - 60 * 60 * 1000

          const entries = rawEntries.map((entry, index) => {
            let updated = entry
            if (entry.executionOrder === undefined) {
              updated = { ...updated, executionOrder: index + 1 }
            }
            if (
              entry.isRunning &&
              entry.startedAt &&
              new Date(entry.startedAt).getTime() < oneHourAgo
            ) {
              updated = { ...updated, isRunning: false }
            }
            updated = {
              ...updated,
              input: normalizeConsoleInput(updated.input),
              output: normalizeConsoleOutput(updated.output),
              error: normalizeConsoleError(updated.error),
              warning:
                typeof updated.warning === 'string'
                  ? (normalizeConsoleError(updated.warning) ?? undefined)
                  : updated.warning,
            }
            return updated
          })

          return {
            ...currentState,
            entries: trimConsoleEntries(entries),
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
