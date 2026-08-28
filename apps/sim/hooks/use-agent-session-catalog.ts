import { useMemo } from 'react'
import {
  type AgentSessionCatalogEntry,
  buildAgentSessionCatalog,
  readAgentSessionSubBlockValue,
  resolveAgentSessionId,
} from '@/lib/workflows/agent-sessions'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface UseAgentSessionCatalogProps {
  blockId: string
  blockType: string
  sessionSubBlockId: string
  compatibleSubBlockIds?: readonly string[]
  previewValue?: unknown
}

interface UseAgentSessionCatalogResult {
  sessions: AgentSessionCatalogEntry[]
  currentSession: AgentSessionCatalogEntry | null
}

/** Reactive workflow-local agent directory used by selectors and canvas badges. */
export function useAgentSessionCatalog({
  blockId,
  blockType,
  sessionSubBlockId,
  compatibleSubBlockIds = [],
  previewValue,
}: UseAgentSessionCatalogProps): UseAgentSessionCatalogResult {
  const blocks = useWorkflowStore((state) => state.blocks)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const subBlockValues = useSubBlockStore((state) =>
    activeWorkflowId
      ? (state.workflowValues[activeWorkflowId] ?? EMPTY_SUBBLOCK_VALUES)
      : EMPTY_SUBBLOCK_VALUES
  )

  return useMemo(() => {
    const sessions = buildAgentSessionCatalog({
      blocks,
      subBlockValues,
      blockType,
      sessionSubBlockId,
      compatibleSubBlockIds,
    })
    const currentBlock = blocks[blockId]
    const storedValue =
      previewValue !== undefined
        ? previewValue
        : currentBlock
          ? readAgentSessionSubBlockValue(currentBlock, subBlockValues[blockId], sessionSubBlockId)
          : undefined
    const currentAgentId = resolveAgentSessionId(blockId, storedValue)

    return {
      sessions,
      currentSession: sessions.find((session) => session.id === currentAgentId) ?? null,
    }
  }, [
    blocks,
    subBlockValues,
    blockType,
    blockId,
    sessionSubBlockId,
    compatibleSubBlockIds,
    previewValue,
  ])
}
