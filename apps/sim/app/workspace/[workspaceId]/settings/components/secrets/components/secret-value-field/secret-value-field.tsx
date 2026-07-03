'use client'

import type { ComponentProps, CSSProperties } from 'react'
import { useState } from 'react'
import { ChipInput } from '@sim/emcn'

const BULLET = '\u2022'

/**
 * Viewers always see this many bullets regardless of the real value, which the
 * server withholds (empty string) for non-admins. A fixed length also avoids
 * leaking the secret's length.
 */
const VIEWER_MASK_LENGTH = 10

type SecretValueFieldProps = Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'onChange' | 'readOnly'
> & {
  value: string
  onChange?: (value: string) => void
  /**
   * Whether the caller may reveal (on focus) and edit the value. When `false`
   * the real value is never shown — only a fixed-length mask — and the field is
   * read-only (e.g. a non-admin viewer).
   */
  canEdit?: boolean
  /** Render the real value without masking, e.g. an overridden/conflicted field. */
  unmasked?: boolean
  /** Force read-only even when {@link canEdit} is true (e.g. a conflicted field). */
  readOnly?: boolean
}

/**
 * The single source of truth for displaying an environment-variable value:
 * masks the value with bullets while unfocused, reveals it on focus for editors,
 * and keeps the field read-only (masked) for viewers who can't edit. Shared by
 * the secrets list and the secret detail page so masking never diverges.
 *
 * Rendered as a {@link ChipInput}; the chip chrome carries the canonical 30px
 * chip-field height, and the caller's `className` only positions it (e.g.
 * `col-span-2`). Values arrive already decrypted for authorized callers; this
 * component only governs on-screen visibility.
 */
export function SecretValueField({
  value,
  onChange,
  canEdit = true,
  unmasked = false,
  readOnly = false,
  onFocus,
  onBlur,
  style,
  className,
  ...props
}: SecretValueFieldProps) {
  const [focused, setFocused] = useState(false)
  const editable = canEdit && !readOnly
  const maskActive = canEdit && !unmasked && !focused
  const displayValue = canEdit ? value : BULLET.repeat(VIEWER_MASK_LENGTH)

  const mergedStyle: CSSProperties | undefined = maskActive
    ? ({ ...style, WebkitTextSecurity: 'disc' } as CSSProperties)
    : style

  return (
    <ChipInput
      {...props}
      className={className}
      type='text'
      value={displayValue}
      readOnly
      style={mergedStyle}
      onChange={(event) => {
        if (editable) onChange?.(event.target.value)
      }}
      onFocus={(event) => {
        if (editable) event.currentTarget.removeAttribute('readOnly')
        event.currentTarget.scrollLeft = 0
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      autoComplete='off'
      autoCorrect='off'
      autoCapitalize='off'
      spellCheck='false'
    />
  )
}
