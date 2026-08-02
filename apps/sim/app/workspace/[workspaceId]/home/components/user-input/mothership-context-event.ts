import type { MothershipAddContextDetail } from '@/lib/mothership/events'
import type { PromptEditorInstance } from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'

type ContextInsertionEditor = Pick<PromptEditorInstance, 'focusAtEnd' | 'insertContext'>

/**
 * Claims a structured context event for one composer and restores text focus.
 * The second-frame focus survives Electron returning focus to a native browser
 * view as its context menu finishes closing.
 */
export function handleMothershipAddContextEvent(
  event: Event,
  editor: ContextInsertionEditor
): boolean {
  if (event.defaultPrevented) return false
  const detail = (event as CustomEvent<MothershipAddContextDetail>).detail
  if (!detail?.context) return false

  event.preventDefault()
  editor.insertContext(detail.context)
  window.requestAnimationFrame(() => editor.focusAtEnd())
  return true
}
