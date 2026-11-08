'use client'

import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react'
import { EnvVarDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/mcp-server-form/mcp-server-form.module.css'
import { checkEnvVarTrigger } from '@/platform/lib/data/workflow-editor/mcp'

interface SecretPicker {
  searchTerm: string
  cursor: number
}

interface EnvVarInputProps {
  id?: string
  /** Names the field for assistive technology; the visible caption belongs to its frame. */
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  workspaceId: string
  /** Secrets that exist; a `{{NAME}}` outside this set stays unhighlighted. */
  availableEnvVars?: Set<string>
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  /** Header names take the bare secret name rather than its `{{NAME}}` reference. */
  stripReferenceBraces?: boolean
}

/**
 * A single-line form field outside any block whose `{{` opens the secret picker at the caret, with
 * references highlighted over the typed text.
 */
export function EnvVarInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  workspaceId,
  availableEnvVars,
  disabled,
  invalid,
  describedBy,
  stripReferenceBraces,
}: EnvVarInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLSpanElement>(null)
  const [picker, setPicker] = useState<SecretPicker | null>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    const cursor = event.target.selectionStart ?? next.length
    const trigger = checkEnvVarTrigger(next, cursor)
    setPicker(trigger.show ? { searchTerm: trigger.searchTerm, cursor } : null)
    onChange(next)
  }

  const handleSelect = (newValue: string, newCursorPosition: number) => {
    const next = stripReferenceBraces ? newValue.replace(/[{}]/g, '') : newValue
    const caret = stripReferenceBraces ? next.length : newCursorPosition
    setPicker(null)
    onChange(next)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  // The picker owns Escape and Enter while it is open, so neither reaches the dialog.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!picker) return
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') setPicker(null)
    }
  }

  return (
    <span
      className={styles.envFrame}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
    >
      <input
        ref={inputRef}
        id={id}
        className={styles.envInput}
        data-type='T043'
        type='text'
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck={false}
        data-lpignore='true'
        data-form-type='other'
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setPicker(null)}
        onScroll={(event) => {
          if (overlayRef.current) overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
        }}
      />
      <span ref={overlayRef} className={styles.envOverlay} data-type='T043' aria-hidden='true'>
        <span className={styles.envOverlayText}>
          {formatDisplayText(value, { availableEnvVars })}
        </span>
      </span>
      {picker && (
        <EnvVarDropdown
          visible
          onSelect={handleSelect}
          searchTerm={picker.searchTerm}
          inputValue={value}
          cursorPosition={picker.cursor}
          onClose={() => setPicker(null)}
          workspaceId={workspaceId}
          inputRef={inputRef}
        />
      )}
    </span>
  )
}
