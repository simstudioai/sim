'use client'

import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { useExecutionStore } from '@/stores/execution'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import { useMothershipModeStore } from '@/stores/mothership-mode/store'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import {
  clearAllExecutionPointers,
  consolePersistence,
  useTerminalConsoleStore,
  waitForConsoleHydration,
} from '@/stores/terminal'
import { resetRegisteredUserData } from '@/stores/user-data-reset-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export async function resetAllStores(): Promise<void> {
  useOperationQueueStore.getState().reset()
  resetRegisteredUserData()
  await waitForConsoleHydration()

  useWorkflowRegistry.setState({
    activeWorkflowId: null,
    error: null,
    hydration: {
      phase: 'idle',
      workspaceId: null,
      workflowId: null,
      requestId: null,
      error: null,
    },
    clipboard: null,
    pendingSelection: null,
  })
  useWorkflowStore.setState({
    currentWorkflowId: null,
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
  })
  useSubBlockStore.setState({ workflowValues: {} })
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
  useMothershipDraftsStore.setState({ drafts: {} })
  useMothershipQueueStore.getState().reset()
  useMothershipModeStore.getState().reset()
  await consolePersistence.persist({ merge: false })
}
