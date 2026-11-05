'use client'

import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/field/field.module.css'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

export interface ControlProps {
  id?: string
  label: string
  name?: string
  defaultValue?: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

export interface TextValueProps {
  /** Controlled text. Leave it out and `defaultValue` keeps the draft in the DOM. */
  value?: string
  onChange?: (value: string) => void
}

/** Native text-entry attributes, passed through as written. */
export interface TextEntryProps {
  type?: 'text' | 'email' | 'url' | 'tel' | 'number' | 'password' | 'time'
  inputMode?: 'text' | 'email' | 'url' | 'tel' | 'numeric' | 'decimal' | 'search'
  autoComplete?: string
  maxLength?: number
  readOnly?: boolean
}

interface InputProps extends ControlProps, TextValueProps, TextEntryProps {
  required?: boolean
  pattern?: string
  placeholder?: string
  spellCheck?: boolean
  /** An action inside the frame, after the text. */
  trailing?: ReactNode
}

export function Input({
  id,
  label,
  name,
  defaultValue,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  placeholder,
  required,
  pattern,
  type,
  inputMode,
  autoComplete,
  maxLength,
  readOnly,
  spellCheck,
  trailing,
}: InputProps) {
  const scrollRef = useScrollEdges<HTMLInputElement>('horizontal')
  return (
    <span className={styles.inputFrame} data-trailing={trailing ? true : undefined}>
      <input
        ref={scrollRef}
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        readOnly={readOnly}
        spellCheck={spellCheck}
        required={required}
        pattern={pattern}
        aria-label={label}
        className={styles.input}
        data-type='T043'
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange && ((event) => onChange(event.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      {trailing}
    </span>
  )
}

interface TextAreaProps
  extends Omit<InputProps, 'pattern' | 'type' | 'inputMode' | 'spellCheck' | 'trailing'> {
  density?: 'expanded'
}

export function TextArea({
  id,
  label,
  name,
  defaultValue,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  placeholder,
  density,
  required,
  autoComplete,
  maxLength,
  readOnly,
}: TextAreaProps) {
  const scrollRef = useScrollEdges<HTMLTextAreaElement>()
  return (
    <span className={styles.inputFrame}>
      <textarea
        ref={scrollRef}
        id={id}
        autoComplete={autoComplete}
        maxLength={maxLength}
        readOnly={readOnly}
        required={required}
        aria-label={label}
        className={styles.input}
        data-type='T043'
        name={name}
        data-density={density}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange && ((event) => onChange(event.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
    </span>
  )
}
