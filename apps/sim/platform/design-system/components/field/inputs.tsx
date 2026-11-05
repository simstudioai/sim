'use client'

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

interface InputProps extends ControlProps, TextValueProps {
  required?: boolean
  pattern?: string
  placeholder?: string
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
}: InputProps) {
  const scrollRef = useScrollEdges<HTMLInputElement>('horizontal')
  return (
    <span className={styles.inputFrame}>
      <input
        ref={scrollRef}
        id={id}
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
    </span>
  )
}

interface TextAreaProps extends Omit<InputProps, 'pattern'> {
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
}: TextAreaProps) {
  const scrollRef = useScrollEdges<HTMLTextAreaElement>()
  return (
    <span className={styles.inputFrame}>
      <textarea
        ref={scrollRef}
        id={id}
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
