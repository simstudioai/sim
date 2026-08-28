'use client'

import type { ComponentProps, CSSProperties } from 'react'
import { useState } from 'react'
import { ChipInput } from '@sim/emcn'

const BULLET = '\u2022'

/**
 * Viewers without reveal access receive a fixed-length mask so the secret's
 * length is not disclosed.
 */
const VIEWER_MASK_LENGTH = 10

type SecretValueFieldProps = Omit<
  ComponentProps<'input'>,
  'type' | 'value' | 'onChange' | 'readOnly'
> & {
  value: string
  onChange?: (value: string) => void
  /**
   * Whether the caller may edit the value. Editors can always reveal it.
   */
  canEdit?: boolean
  /** Whether a read-only caller may reveal the value on focus. */
  canReveal?: boolean
  /** Render the real value without masking, e.g. an overridden/conflicted field. */
  unmasked?: boolean
  /** Force read-only even when {@link canEdit} is true (e.g. a conflicted field). */
  readOnly?: boolean
}

/**
 * The single source of truth for displaying an environment-variable value:
 * masks revealable values while unfocused, reveals them on focus, and grants
 * editing independently. Callers without reveal access receive a fixed-length
 * mask. Shared by the secrets list and secret detail page.
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
  canReveal = false,
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
  const revealable = canEdit || canReveal
  const maskActive = revealable && !unmasked && !focused
  const displayValue = revealable ? value : BULLET.repeat(VIEWER_MASK_LENGTH)

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
