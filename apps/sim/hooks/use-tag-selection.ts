import { useCallback } from 'react'
import { useSocket } from '@/contexts/socket-context'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

/**
 * Hook for handling immediate tag dropdown selections
 * This bypasses the debounced operation queue system for instant feedback
 */
export function useTagSelection(blockId: string, subblockId: string) {
  const { emitTagSelection } = useSocket()
  const subBlockStore = useSubBlockStore()

  const emitTagSelectionValue = useCallback(
    (value: any) => {
      // Update local store immediately for instant feedback
      subBlockStore.setValue(blockId, subblockId, value)

      // Emit to server immediately (no debouncing)
      emitTagSelection(blockId, subblockId, value)
    },
    [blockId, subblockId, emitTagSelection, subBlockStore]
  )

  return emitTagSelectionValue
}
