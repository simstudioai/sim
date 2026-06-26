import type { Ref } from 'react'
import type { ChainedCommands } from '@tiptap/core'
import { normalizeLinkHref } from '../markdown-fidelity'

/**
 * Applies a link to the chain's current selection: normalizes `rawHref`, expands to the full link
 * mark, and sets it — or removes the link when the href is empty/unsafe. The caller supplies a chain
 * already focused with the target selection (the captured bubble-menu range / the hovered link range).
 */
export function applyLink(chain: ChainedCommands, rawHref: string): void {
  const href = normalizeLinkHref(rawHref.trim())
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
}

/**
 * The inline link-URL field shared by the bubble menu and the link hover card — Enter commits, Escape
 * cancels. Styled to sit flush in the 28px floating micro-toolbar (a `ChipInput` would impose its own
 * field chrome and break the bar), so this is a deliberate raw `<input>`.
 */
export function LinkUrlInput({ value, onChange, onCommit, onCancel, inputRef }: LinkUrlInputProps) {
  return (
    <input
      ref={inputRef}
      aria-label='Link URL'
      type='text'
      inputMode='url'
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      placeholder='Paste or type a link…'
      className='h-[28px] w-[220px] bg-transparent px-2 text-[var(--text-body)] text-small outline-none placeholder:text-[var(--text-subtle)]'
    />
  )
}
