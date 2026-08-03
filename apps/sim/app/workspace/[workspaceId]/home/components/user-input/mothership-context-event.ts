import type { MothershipAddContextDetail } from '@/lib/mothership/events'
import type { PromptEditorInstance } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'

type ContextInsertionEditor = Pick<
  PromptEditorInstance,
  'focusAtEnd' | 'insertContext' | 'insertContextChips' | 'textareaRef'
>

/**
 * Claims an add-context event for one composer. The detail carries either a
 * single `context` (browser/terminal selection actions) appended at the end of
 * the draft, or a `contexts` batch (file/table highlight-to-chat) inserted at
 * the caret.
 *
 * The single-context path restores text focus on a second frame so it survives
 * Electron returning focus to a native browser view as its context menu
 * finishes closing. The batch path focuses synchronously, preserving the caret
 * position `insertContextChips` just computed.
 */
export function handleMothershipAddContextEvent(
  event: Event,
  editor: ContextInsertionEditor
): boolean {
  if (event.defaultPrevented) return false
  const detail = (event as CustomEvent<MothershipAddContextDetail>).detail

  if (detail?.context) {
    event.preventDefault()
    editor.insertContext(detail.context)
    window.requestAnimationFrame(() => editor.focusAtEnd())
    return true
  }

  if (detail?.contexts?.length) {
    event.preventDefault()
    editor.insertContextChips(detail.contexts)
    editor.textareaRef.current?.focus()
    return true
  }

  return false
}
