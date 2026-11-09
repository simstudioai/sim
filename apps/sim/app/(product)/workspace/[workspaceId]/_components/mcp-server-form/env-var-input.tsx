'use client'

import { type ChangeEvent, type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { EnvVarDropdown } from '@/app/(product)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/mcp-server-form/mcp-server-form.module.css'
import { checkEnvVarTrigger } from '@/platform/lib/data/credentials'

interface SecretPicker {
  searchTerm: string
  cursor: number
}

const SECRET_REFERENCE = /\{\{[^{}]+\}\}/g

/**
 * The typed text with each `{{NAME}}` that names an existing secret highlighted. A server's URL and
 * headers resolve secrets only, never block references, so nothing else is marked.
 */
function highlightSecretReferences(text: string, availableEnvVars?: Set<string>): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  for (const match of text.matchAll(SECRET_REFERENCE)) {
    const index = match.index
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index))
    const name = match[0].slice(2, -2).trim()
    nodes.push(
      !availableEnvVars || availableEnvVars.has(name) ? (
        <span key={index} className={styles.reference}>
          {match[0]}
        </span>
      ) : (
        match[0]
      )
    )
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
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
          {highlightSecretReferences(value, availableEnvVars)}
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
