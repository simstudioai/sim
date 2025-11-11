import { useCallback } from 'react'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'

/**
 * Shared hook for managing block focus state and interactions.
 */
export function useBlockFocus(blockId: string) {
  const setCurrentBlockId = usePanelEditorStore((state) => state.setCurrentBlockId)
  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const isFocused = currentBlockId === blockId

  const handleClick = useCallback(() => {
    setCurrentBlockId(blockId)
  }, [blockId, setCurrentBlockId])

  return { isFocused, handleClick }
}
