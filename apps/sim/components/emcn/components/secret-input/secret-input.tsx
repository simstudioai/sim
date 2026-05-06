/**
 * A password-style input that masks its value with bullets only while the
 * field is unfocused.
 *
 * @remarks
 * Unlike a standard `<input type="password">`, this keeps the real text
 * visible while the user is actively editing — so they can verify pasted
 * secrets like signing tokens or API keys — and only swaps to bullets on
 * blur. Uses plain `type="text"` so password managers don't auto-fill.
 *
 * @example
 * ```tsx
 * import { SecretInput } from '@/components/emcn'
 *
 * <SecretInput
 *   id='signing-secret'
 *   value={secret}
 *   onChange={setSecret}
 *   placeholder='Paste your signing secret'
 * />
 * ```
 */
'use client'

import * as React from 'react'
import { Input, type InputProps } from '../input/input'

export interface SecretInputProps
  extends Omit<InputProps, 'type' | 'value' | 'onChange' | 'defaultValue'> {
  /** Current value. Rendered as bullets when the input is not focused. */
  value: string
  /** Called with the new value on every real edit (focused-only). */
  onChange: (next: string) => void
}

const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  ({ value, onChange, onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false)
    const displayValue = isFocused ? value : '•'.repeat(value.length)

    return (
      <Input
        ref={ref}
        type='text'
        value={displayValue}
        onChange={(e) => {
          // Guard against synthetic change events (autofill, form reset)
          // firing while blurred, which would otherwise overwrite the real
          // value with bullet characters.
          if (!isFocused) return
          onChange(e.target.value)
        }}
        onFocus={(e) => {
          setIsFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setIsFocused(false)
          onBlur?.(e)
        }}
        autoComplete='off'
        {...props}
      />
    )
  }
)
SecretInput.displayName = 'SecretInput'

export { SecretInput }
