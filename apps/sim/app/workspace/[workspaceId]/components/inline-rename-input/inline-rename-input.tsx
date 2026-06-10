'use client'

import { useEffect, useRef } from 'react'

interface InlineRenameInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  /**
   * Disables the field while the rename is in flight, mirroring the sidebar's
   * `disabled={isRenaming}`. Threaded from `useInlineRename`'s `isSaving`.
   */
  disabled?: boolean
}

/**
 * Inline rename field used by every resource rename surface (tables, files,
 * knowledge), triggered from a context menu. Matches the sidebar workflow rename
 * (`useItemRename`) input verbatim: same focus-reset className and attribute set
 * (`maxLength`, autocomplete/correct/capitalize off, spellCheck off), focus +
 * select on mount, commit on blur, Enter to submit, Escape to cancel, disabled
 * while saving. The only intentional delta is the table-cell `size={...}`
 * auto-width, which the sidebar (full-width row) does not need.
 *
 * The triggering menu uses `onCloseAutoFocus={(e) => e.preventDefault()}`, so the
 * Radix focus-scope teardown never steals focus back from this freshly-focused
 * input. `onSubmit` (from `useInlineRename`) is idempotent via its `doneRef`
 * guard, so a blur racing an Enter/Escape commit is a harmless no-op.
 *
 * TODO: the resource rename still intermittently unfocuses; the deeper re-render
 * cause (parent remounting the editing cell) is tracked separately. This input is
 * aligned to the proven sidebar pattern as the first step.
 */
export function InlineRenameInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <input
      ref={inputRef}
      type='text'
      value={value}
      size={Math.max(value.length + 2, 5)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onSubmit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
      maxLength={100}
      disabled={disabled}
      autoComplete='off'
      autoCorrect='off'
      autoCapitalize='off'
      spellCheck='false'
    />
  )
}
