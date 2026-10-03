import type { Ref } from 'react'
import type { ChainedCommands } from '@tiptap/core'
import { normalizeLinkHref } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { ToolbarInput } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/toolbar-input'

/**
 * Applies a link to the chain's current selection: normalizes `rawHref`, expands to the full link
 * mark, and sets it. Clearing the field removes the link; a target that survives normalization
 * replaces it. A target that normalizes away is neither set nor removed — the editor seeds this field
 * with the raw href, so committing an untouched one would otherwise delete a link the user only
 * opened, and dropping an unsafe target is not the same instruction as "remove this link". The
 * caller supplies a chain already focused with the target selection (the captured bubble-menu range /
 * the hovered link range).
 */
export function applyLink(chain: ChainedCommands, rawHref: string): void {
  const trimmed = rawHref.trim()
  const href = normalizeLinkHref(trimmed)
  if (!href && trimmed) return
  chain.extendMarkRange('link')
  if (href) chain.setLink({ href })
  else chain.unsetLink()
  chain.run()
}

interface LinkUrlInputProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  inputRef: Ref<HTMLInputElement>
  readOnly?: boolean
}

/** Inline link field shared by the text-selection toolbar and link hover card. */
export function LinkUrlInput(props: LinkUrlInputProps) {
  return (
    <ToolbarInput {...props} label='Link URL' inputMode='url' placeholder='Paste or type a link…' />
  )
}
