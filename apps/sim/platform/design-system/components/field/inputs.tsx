'use client'

import type { ReactNode } from 'react'
import { CopyButton } from '@/platform/design-system/components/button/copy-button'
import styles from '@/platform/design-system/components/field/field.shared.module.css'
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
  viewOnly?: boolean
}

interface InputProps extends ControlProps, TextValueProps, TextEntryProps {
  required?: boolean
  pattern?: string
  placeholder: string
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
  viewOnly,
  spellCheck,
  trailing,
}: InputProps) {
  const scrollRef = useScrollEdges<HTMLInputElement>('horizontal')
  return (
    <span
      className={styles.inputFrame}
      data-view-only={viewOnly || undefined}
      data-trailing={!viewOnly && trailing ? true : undefined}
    >
      <input
        ref={scrollRef}
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        readOnly={readOnly || viewOnly}
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
      {viewOnly ? (
        <span className={styles.copyAction}>
          <CopyButton
            label={`Copy ${label}`}
            text={value ?? defaultValue ?? ''}
            size='compact'
            disabled={disabled}
          />
        </span>
      ) : (
        trailing && <span className={styles.trailing}>{trailing}</span>
      )}
    </span>
  )
}

interface TextAreaProps extends Omit<InputProps, 'pattern' | 'type' | 'inputMode' | 'trailing'> {
  defaultSize?: 'regular' | 'expanded' | 'large'
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
  defaultSize = 'regular',
  required,
  autoComplete,
  spellCheck,
  maxLength,
  readOnly,
  viewOnly,
}: TextAreaProps) {
  const scrollRef = useScrollEdges<HTMLTextAreaElement>()
  return (
    <span
      className={`${styles.inputFrame} ${styles.textareaFrame}`}
      data-default-size={defaultSize}
      data-view-only={viewOnly || undefined}
    >
      <textarea
        ref={scrollRef}
        id={id}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        maxLength={maxLength}
        readOnly={readOnly || viewOnly}
        required={required}
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
      {viewOnly && (
        <span className={styles.copyAction}>
          <CopyButton
            label={`Copy ${label}`}
            text={value ?? defaultValue ?? ''}
            size='compact'
            disabled={disabled}
          />
        </span>
      )}
    </span>
  )
}
