'use client'

import { type ClipboardEventHandler, useState } from 'react'
import { Input } from '@sim/emcn/field/inputs'

const BULLET = '•'

/** Fixed-length masks avoid disclosing the secret's length. */
const VIEWER_MASK_LENGTH = 10

interface SecretValueInputProps {
  id?: string
  label: string
  value: string
  onChange?: (value: string) => void
  /** Whether the caller may edit the value. Editors can always reveal it. */
  canEdit?: boolean
  /** Whether a read-only caller may reveal the value on focus. */
  canReveal?: boolean
  /** Shows the real value without masking, as a shadowed value does. */
  unmasked?: boolean
  /** Read-only even for an editor, as a shadowed value is. */
  readOnly?: boolean
  placeholder: string
  name?: string
  onPaste?: ClipboardEventHandler<HTMLInputElement>
}

/**
 * How a secret's value shows: masked while unfocused, revealed on focus, editable independently.
 * A viewer without reveal access sees a fixed-length mask. Values arrive decrypted only for
 * authorized viewers; this governs on-screen visibility alone. Read-only until focused so a
 * password manager does not fill it.
 */
export function SecretValueInput({
  id,
  label,
  value,
  onChange,
  canEdit = true,
  canReveal = false,
  unmasked = false,
  readOnly = false,
  placeholder,
  name,
  onPaste,
}: SecretValueInputProps) {
  const [focused, setFocused] = useState(false)
  const editable = canEdit && !readOnly
  const revealable = canEdit || canReveal
  const maskActive = revealable && !unmasked && !focused
  const displayValue =
    !revealable || (!editable && maskActive && value.length > 0)
      ? BULLET.repeat(VIEWER_MASK_LENGTH)
      : value

  return (
    <Input
      id={id}
      label={label}
      value={displayValue}
      placeholder={placeholder}
      name={name}
      readOnly
      masked={editable && maskActive}
      onChange={(next) => {
        if (editable) onChange?.(next)
      }}
      onFocus={(event) => {
        if (editable) event.currentTarget.removeAttribute('readOnly')
        event.currentTarget.scrollLeft = 0
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onPaste={onPaste}
      autoComplete='off'
      autoCorrect='off'
      autoCapitalize='off'
      spellCheck={false}
    />
  )
}
