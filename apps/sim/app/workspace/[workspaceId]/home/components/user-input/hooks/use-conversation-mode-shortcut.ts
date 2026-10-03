import { type KeyboardEvent, type RefObject, useCallback } from 'react'
import { getConversationModes } from '@/app/workspace/[workspaceId]/home/components/user-input/utils/conversation-modes'
import type { ChatRequestMode } from '@/app/workspace/[workspaceId]/home/types'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

interface UseConversationModeShortcutOptions {
  value: ChatRequestMode
  searchEnabled?: boolean
  onChange?: (mode: ChatRequestMode) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  pickerOpen: boolean
}

/** Cycles the focused composer's available modes without disturbing its draft selection. */
export function useConversationModeShortcut({
  value,
  searchEnabled = false,
  onChange,
  textareaRef,
  pickerOpen,
}: UseConversationModeShortcutOptions) {
  const planEnabled = useFeatureFlag('mothership-plan-mode')

  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const textarea = textareaRef.current
      if (
        !onChange ||
        pickerOpen ||
        !textarea ||
        event.target !== textarea ||
        event.defaultPrevented ||
        event.key !== 'Tab' ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.nativeEvent.isComposing
      )
        return

      const modes = getConversationModes(searchEnabled, planEnabled)
      if (modes.length < 2) return
      event.preventDefault()
      if (event.repeat) return
      const nextMode = modes[(modes.findIndex((mode) => mode.value === value) + 1) % modes.length]
      const { selectionStart, selectionEnd, selectionDirection } = textarea
      onChange(nextMode.value)

      // Search and Build mount different textareas; restore the selection after React commits.
      requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current
        if (
          !nextTextarea ||
          (document.activeElement !== document.body &&
            document.activeElement !== textarea &&
            document.activeElement !== nextTextarea)
        )
          return
        nextTextarea.focus({ preventScroll: true })
        nextTextarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection)
      })
    },
    [value, searchEnabled, planEnabled, onChange, textareaRef, pickerOpen]
  )
}
