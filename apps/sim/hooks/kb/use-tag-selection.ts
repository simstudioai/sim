import { useCallback } from 'react'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

/**
 * Hook for handling immediate tag dropdown selections
 * Uses the collaborative workflow system but with immediate processing
 */
export function useTagSelection(blockId: string, subblockId: string) {
  const { collaborativeSetTagSelection } = useCollaborativeWorkflow()

  const emitTagSelectionValue = useCallback(
    (value: string) => {
      collaborativeSetTagSelection(blockId, subblockId, value)
    },
    [blockId, subblockId, collaborativeSetTagSelection]
  )

  return emitTagSelectionValue
}
