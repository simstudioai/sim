import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { redactApiKeys } from '@/lib/core/security/redaction'
import { getQueryClient } from '@/app/_shell/providers/query-provider'
import type { NormalizedBlockOutput } from '@/executor/types'
import { type GeneralSettings, generalSettingsKeys } from '@/hooks/queries/general-settings'
import { useExecutionStore } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { consolePersistence, loadConsoleData } from '@/stores/terminal/console/storage'
import type {
  ConsoleEntry,
  ConsoleEntryLocation,
  ConsoleStore,
  ConsoleUpdate,
} from '@/stores/terminal/console/types'
import {
  normalizeConsoleError,
  normalizeConsoleInput,
  normalizeConsoleOutput,
  safeConsoleStringify,
  trimWorkflowConsoleEntries,
} from '@/stores/terminal/console/utils'

const logger = createLogger('TerminalConsoleStore')
const EMPTY_CONSOLE_ENTRIES: ConsoleEntry[] = []

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

const getBlockExecutionKey = (blockId: string, executionId?: string): string =>
  `${executionId ?? 'no-execution'}:${blockId}`

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

function cloneWorkflowEntries(
  workflowEntries: Record<string, ConsoleEntry[]>
): Record<string, ConsoleEntry[]> {
  return { ...workflowEntries }
}

function removeWorkflowIndexes(
  workflowId: string,
  entries: ConsoleEntry[],
  entryIdsByBlockExecution: Record<string, string[]>,
  entryLocationById: Record<string, ConsoleEntryLocation>
): void {
  for (const entry of entries) {
    delete entryLocationById[entry.id]
    const blockExecutionKey = getBlockExecutionKey(entry.blockId, entry.executionId)
    const existingIds = entryIdsByBlockExecution[blockExecutionKey]
    if (!existingIds) {
      continue
    }

    const nextIds = existingIds.filter((entryId) => entryId !== entry.id)
    if (nextIds.length === 0) {
      delete entryIdsByBlockExecution[blockExecutionKey]
    } else {
      entryIdsByBlockExecution[blockExecutionKey] = nextIds
    }
  }
}

function indexWorkflowEntries(
  workflowId: string,
  entries: ConsoleEntry[],
  entryIdsByBlockExecution: Record<string, string[]>,
  entryLocationById: Record<string, ConsoleEntryLocation>
): void {
  entries.forEach((entry, index) => {
    entryLocationById[entry.id] = { workflowId, index }
    const blockExecutionKey = getBlockExecutionKey(entry.blockId, entry.executionId)
    const existingIds = entryIdsByBlockExecution[blockExecutionKey]
    if (existingIds) {
      entryIdsByBlockExecution[blockExecutionKey] = [...existingIds, entry.id]
    } else {
      entryIdsByBlockExecution[blockExecutionKey] = [entry.id]
    }
  })
}

function rebuildWorkflowStateMaps(workflowEntries: Record<string, ConsoleEntry[]>) {
  const entryIdsByBlockExecution: Record<string, string[]> = {}
  const entryLocationById: Record<string, ConsoleEntryLocation> = {}

  Object.entries(workflowEntries).forEach(([workflowId, entries]) => {
    indexWorkflowEntries(workflowId, entries, entryIdsByBlockExecution, entryLocationById)
  })

  return { entryIdsByBlockExecution, entryLocationById }
}

function replaceWorkflowEntries(
  state: ConsoleStore,
  workflowId: string,
  nextEntries: ConsoleEntry[]
): Pick<ConsoleStore, 'workflowEntries' | 'entryIdsByBlockExecution' | 'entryLocationById'> {
  const workflowEntries = cloneWorkflowEntries(state.workflowEntries)
  const entryIdsByBlockExecution = { ...state.entryIdsByBlockExecution }
  const entryLocationById = { ...state.entryLocationById }
  const previousEntries = workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES

  removeWorkflowIndexes(workflowId, previousEntries, entryIdsByBlockExecution, entryLocationById)

  if (nextEntries.length === 0) {
    delete workflowEntries[workflowId]
  } else {
    workflowEntries[workflowId] = nextEntries
    indexWorkflowEntries(workflowId, nextEntries, entryIdsByBlockExecution, entryLocationById)
  }

  return { workflowEntries, entryIdsByBlockExecution, entryLocationById }
}

function appendWorkflowEntry(
  state: ConsoleStore,
  workflowId: string,
  newEntry: ConsoleEntry,
  trimmedEntries: ConsoleEntry[]
): Pick<ConsoleStore, 'workflowEntries' | 'entryIdsByBlockExecution' | 'entryLocationById'> {
  const workflowEntries = cloneWorkflowEntries(state.workflowEntries)
  const previousEntries = workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES
  workflowEntries[workflowId] = trimmedEntries

  const entryLocationById = { ...state.entryLocationById }
  const entryIdsByBlockExecution = { ...state.entryIdsByBlockExecution }

  const survivingIds = new Set(trimmedEntries.map((e) => e.id))
  const droppedEntries = previousEntries.filter((e) => !survivingIds.has(e.id))
  if (droppedEntries.length > 0) {
    removeWorkflowIndexes(workflowId, droppedEntries, entryIdsByBlockExecution, entryLocationById)
  }

  trimmedEntries.forEach((entry, index) => {
    entryLocationById[entry.id] = { workflowId, index }
  })

  const blockExecutionKey = getBlockExecutionKey(newEntry.blockId, newEntry.executionId)
  const existingIds = entryIdsByBlockExecution[blockExecutionKey]
  if (existingIds) {
    if (!existingIds.includes(newEntry.id)) {
      entryIdsByBlockExecution[blockExecutionKey] = [...existingIds, newEntry.id]
    }
  } else {
    entryIdsByBlockExecution[blockExecutionKey] = [newEntry.id]
  }

  return { workflowEntries, entryIdsByBlockExecution, entryLocationById }
}

interface NotifyBlockErrorParams {
  error: unknown
  blockName: string
  workflowId?: string
  logContext: Record<string, unknown>
}

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
  devtools((set, get) => ({
    workflowEntries: {},
    entryIdsByBlockExecution: {},
    entryLocationById: {},
    isOpen: false,
    _hasHydrated: false,

    addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => {
      if (shouldSkipEntry(entry.output)) {
        return get().getWorkflowEntries(entry.workflowId)[0] as ConsoleEntry | undefined
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
        id: generateId(),
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
        const workflowEntries = state.workflowEntries[entry.workflowId] ?? EMPTY_CONSOLE_ENTRIES
        const nextWorkflowEntries = trimWorkflowConsoleEntries([createdEntry, ...workflowEntries])
        return appendWorkflowEntry(state, entry.workflowId, createdEntry, nextWorkflowEntries)
      })

      if (createdEntry.isRunning) {
        consolePersistence.onRunningEntryAdded()
      }

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
      set((state) => replaceWorkflowEntries(state, workflowId, EMPTY_CONSOLE_ENTRIES))
      useExecutionStore.getState().clearRunPath(workflowId)
      consolePersistence.persist()
    },

    clearExecutionEntries: (executionId: string) =>
      set((state) => {
        const nextWorkflowEntries = cloneWorkflowEntries(state.workflowEntries)
        let didChange = false

        Object.entries(nextWorkflowEntries).forEach(([workflowId, entries]) => {
          const filteredEntries = entries.filter((entry) => entry.executionId !== executionId)
          if (filteredEntries.length !== entries.length) {
            nextWorkflowEntries[workflowId] = filteredEntries
            didChange = true
          }
        })

        if (!didChange) {
          return state
        }

        const normalizedEntries = Object.fromEntries(
          Object.entries(nextWorkflowEntries).filter(([, entries]) => entries.length > 0)
        )

        return {
          workflowEntries: normalizedEntries,
          ...rebuildWorkflowStateMaps(normalizedEntries),
        }
      }),

    exportConsoleCSV: (workflowId: string) => {
      const entries = get().getWorkflowEntries(workflowId)

      if (entries.length === 0) {
        return
      }

      const formatCSVValue = (value: any): string => {
        if (value === null || value === undefined) {
          return ''
        }

        let stringValue = typeof value === 'object' ? safeConsoleStringify(value) : String(value)

        if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
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
      return get().workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES
    },

    toggleConsole: () => {
      set((state) => ({ isOpen: !state.isOpen }))
    },

    updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => {
      set((state) => {
        const candidateIds =
          state.entryIdsByBlockExecution[getBlockExecutionKey(blockId, executionId)] ?? []
        if (candidateIds.length === 0) {
          return state
        }

        const workflowId = state.entryLocationById[candidateIds[0]]?.workflowId
        if (!workflowId) {
          return state
        }

        const currentEntries = state.workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES
        let nextEntries: ConsoleEntry[] | null = null

        for (const candidateId of candidateIds) {
          const location = state.entryLocationById[candidateId]
          if (!location || location.workflowId !== workflowId) continue

          const source = nextEntries ?? currentEntries
          const entry = source[location.index]
          if (!entry || entry.id !== candidateId) continue
          if (!matchesEntryForUpdate(entry, blockId, executionId, update)) continue

          if (!nextEntries) {
            nextEntries = [...currentEntries]
          }

          if (typeof update === 'string') {
            const newOutput = normalizeConsoleOutput(updateBlockOutput(entry.output, update))
            nextEntries[location.index] = { ...entry, output: newOutput }
            continue
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

          nextEntries[location.index] = updatedEntry
        }

        if (!nextEntries) {
          return state
        }

        const workflowEntriesClone = cloneWorkflowEntries(state.workflowEntries)
        workflowEntriesClone[workflowId] = nextEntries
        return {
          workflowEntries: workflowEntriesClone,
          entryIdsByBlockExecution: state.entryIdsByBlockExecution,
          entryLocationById: state.entryLocationById,
        }
      })

      if (typeof update === 'object' && update.error) {
        const matchingEntry = get()
          .getWorkflowEntries(
            get().entryLocationById[
              (get().entryIdsByBlockExecution[getBlockExecutionKey(blockId, executionId)] ??
                [])[0] ?? ''
            ]?.workflowId ?? ''
          )
          .find((entry) => matchesEntryForUpdate(entry, blockId, executionId, update))
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
        const workflowEntries = state.workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES
        let didChange = false
        const updatedEntries = workflowEntries.map((entry) => {
          if (entry.workflowId === workflowId && entry.isRunning) {
            didChange = true
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
        if (!didChange) {
          return state
        }
        return replaceWorkflowEntries(state, workflowId, updatedEntries)
      })
    },
  }))
)

/**
 * Hydrates the console store from IndexedDB on startup.
 * Applies the same normalization and trimming as the old persist merge.
 */
async function hydrateConsoleStore(): Promise<void> {
  try {
    const data = await loadConsoleData()

    if (!data) {
      useTerminalConsoleStore.setState({ _hasHydrated: true })
      return
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000

    const workflowEntries = Object.fromEntries(
      Object.entries(data.workflowEntries).map(([workflowId, entries]) => [
        workflowId,
        trimWorkflowConsoleEntries(
          entries.map((entry, index) => {
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
        ),
      ])
    )

    const currentState = useTerminalConsoleStore.getState()
    const mergedWorkflowEntries = { ...workflowEntries }

    for (const [wfId, currentEntries] of Object.entries(currentState.workflowEntries)) {
      if (currentEntries.length > 0) {
        const persistedEntries = mergedWorkflowEntries[wfId] ?? []
        const persistedIds = new Set(persistedEntries.map((e) => e.id))
        const newEntries = currentEntries.filter((e) => !persistedIds.has(e.id))
        if (newEntries.length > 0) {
          mergedWorkflowEntries[wfId] = trimWorkflowConsoleEntries([
            ...newEntries,
            ...persistedEntries,
          ])
        }
      }
    }

    useTerminalConsoleStore.setState({
      workflowEntries: mergedWorkflowEntries,
      ...rebuildWorkflowStateMaps(mergedWorkflowEntries),
      isOpen: data.isOpen,
      _hasHydrated: true,
    })
  } catch (error) {
    logger.error('Failed to hydrate console store', { error })
    useTerminalConsoleStore.setState({ _hasHydrated: true })
  }
}

if (typeof window !== 'undefined') {
  consolePersistence.bind(() => {
    const state = useTerminalConsoleStore.getState()
    return {
      workflowEntries: state.workflowEntries,
      isOpen: state.isOpen,
    }
  })

  hydrateConsoleStore()

  window.addEventListener('pagehide', () => consolePersistence.persist())
}

export function useWorkflowConsoleEntries(workflowId?: string): ConsoleEntry[] {
  return useTerminalConsoleStore(
    useShallow((state) => {
      if (!workflowId) {
        return EMPTY_CONSOLE_ENTRIES
      }

      return state.workflowEntries[workflowId] ?? EMPTY_CONSOLE_ENTRIES
    })
  )
}

export function useConsoleEntry(entryId?: string | null): ConsoleEntry | null {
  return useTerminalConsoleStore((state) => {
    if (!entryId) {
      return null
    }

    const location = state.entryLocationById[entryId]
    if (!location) {
      return null
    }

    const entry = state.workflowEntries[location.workflowId]?.[location.index]
    if (!entry || entry.id !== entryId) {
      return null
    }

    return entry
  })
}
