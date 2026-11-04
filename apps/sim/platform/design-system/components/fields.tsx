import { type ReactNode, useId } from 'react'
import styles from '@/platform/design-system/components/components.module.css'
import { Input, Select, TextArea } from '@/platform/design-system/components/inputs'

interface FieldProps {
  label: string
  optional?: boolean
  error?: string
  disabled?: boolean
  name?: string
  defaultValue?: string
}

interface FieldFrameProps {
  id?: string
  label: string
  optional?: boolean
  error?: string
  children: ReactNode
}

export function FieldFrame({ id, label, optional, error, children }: FieldFrameProps) {
  const caption = (
    <>
      {label}
      {optional && (
        <span className={styles.optional} data-type='T060'>
          {' '}
          (optional)
        </span>
      )}
    </>
  )
  return (
    <div className={styles.field}>
      {id ? (
        <label htmlFor={id} data-type='T059'>
          {caption}
        </label>
      ) : (
        <span data-type='T059'>{caption}</span>
      )}
      {children}
      {error && (
        <span id={id ? `${id}-error` : undefined} className={styles.error} data-type='T052'>
          {error}
        </span>
      )}
    </div>
  )
}

interface TextFieldProps extends FieldProps {
  placeholder?: string
}

export function TextField({
  label,
  optional,
  error,
  disabled,
  name,
  defaultValue,
  placeholder,
}: TextFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error}>
      <Input
        id={id}
        label={label}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
      />
    </FieldFrame>
  )
}

interface TextAreaFieldProps extends FieldProps {
  placeholder?: string
}

export function TextAreaField({
  label,
  optional,
  error,
  disabled,
  name,
  defaultValue,
  placeholder,
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error}>
      <TextArea
        id={id}
        label={label}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
      />
    </FieldFrame>
  )
}

interface SelectFieldProps extends FieldProps {
  options: ReadonlyArray<{ value: string; label: string }>
}

export function SelectField({
  label,
  optional,
  error,
  disabled,
  name,
  defaultValue,
  options,
}: SelectFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error}>
      <Select
        id={id}
        label={label}
        name={name}
        defaultValue={defaultValue}
        options={options}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
      />
    </FieldFrame>
  )
}
