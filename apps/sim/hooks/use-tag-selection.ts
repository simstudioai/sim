import { useCallback } from 'react'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'

/**
 * Hook for handling immediate tag dropdown selections
 * Uses the collaborative workflow system but with immediate processing
 */
export function useTagSelection(blockId: string, subblockId: string) {
  const { collaborativeSetTagSelection } = useCollaborativeWorkflow()

  const emitTagSelectionValue = useCallback(
    (value: any) => {
      // Use the collaborative system with immediate processing (no debouncing)
      collaborativeSetTagSelection(blockId, subblockId, value)
    },
    [blockId, subblockId, collaborativeSetTagSelection]
  )

  return emitTagSelectionValue
}
