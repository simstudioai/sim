'use client'

import { getQueryClient } from '@/hooks/queries/utils/get-query-client'
import { useExecutionStore } from '@/stores/execution'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import { useMothershipOutgoingStore } from '@/stores/mothership-outgoing/store'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import {
  clearAllExecutionPointers,
  consolePersistence,
  useTerminalConsoleStore,
  waitForConsoleHydration,
} from '@/stores/terminal'
import { resetRegisteredUserData } from '@/stores/user-data-reset-registry'

export async function resetAllStores(): Promise<void> {
  useOperationQueueStore.getState().reset()
  resetRegisteredUserData()
  await waitForConsoleHydration()

  getQueryClient().clear()
  useExecutionStore.getState().reset()
  useTerminalConsoleStore.setState({
    workflowEntries: {},
    entryIdsByBlockExecution: {},
    entryLocationById: {},
    isOpen: false,
  })
  consolePersistence.reset()
  clearAllExecutionPointers()
  useMothershipDraftsStore.getState().reset()
  useMothershipOutgoingStore.getState().reset()
  await consolePersistence.persist({ merge: false })
}
