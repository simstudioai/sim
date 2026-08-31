'use client'

import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { environmentKeys } from '@/hooks/queries/environment'
import { useExecutionStore } from '@/stores/execution'
import { useMothershipDraftsStore } from '@/stores/mothership-drafts/store'
import { consolePersistence, useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function resetAllStores(): void {
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
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  getQueryClient().removeQueries({ queryKey: environmentKeys.all })
  useExecutionStore.getState().reset()
  useTerminalConsoleStore.setState({
    workflowEntries: {},
    entryIdsByBlockExecution: {},
    entryLocationById: {},
    isOpen: false,
  })
  consolePersistence.persist()
  useMothershipDraftsStore.setState({ drafts: {} })
}
