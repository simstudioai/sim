'use client'

import type {
  ClipboardEventHandler,
  FocusEventHandler,
  ReactNode,
  Ref,
  SyntheticEvent,
  UIEventHandler,
} from 'react'
import { useCallback } from 'react'
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
  type?:
    | 'text'
    | 'email'
    | 'url'
    | 'tel'
    | 'number'
    | 'password'
    | 'time'
    | 'date'
    | 'datetime-local'
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
  /** Draws a text input's value as dots. */
  masked?: boolean
  autoCapitalize?: string
  autoCorrect?: string
  onFocus?: FocusEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
  onPaste?: ClipboardEventHandler<HTMLInputElement>
  onSelect?: (event: SyntheticEvent<HTMLInputElement>) => void
  onScroll?: UIEventHandler<HTMLInputElement>
  /** The input element, for a caller that places its caret. */
  inputRef?: Ref<HTMLInputElement>
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
  masked,
  autoCapitalize,
  autoCorrect,
  onFocus,
  onBlur,
  onPaste,
  onSelect,
  onScroll,
  inputRef,
}: InputProps) {
  const scrollRef = useScrollEdges<HTMLInputElement>('horizontal')
  const elementRef = useCallback(
    (element: HTMLInputElement | null) => {
      const stopMeasuring = scrollRef(element)
      if (typeof inputRef === 'function') inputRef(element)
      else if (inputRef) inputRef.current = element
      return () => {
        stopMeasuring?.()
        if (typeof inputRef === 'function') inputRef(null)
        else if (inputRef) inputRef.current = null
      }
    },
    [scrollRef, inputRef]
  )
  return (
    <span
      className={styles.inputFrame}
      data-view-only={viewOnly || undefined}
      data-trailing={!viewOnly && trailing ? true : undefined}
    >
      <input
        ref={elementRef}
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
        data-masked={masked || undefined}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange && ((event) => onChange(event.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        onFocus={onFocus}
        onBlur={onBlur}
        onPaste={onPaste}
        onSelect={onSelect}
        onScroll={onScroll}
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
