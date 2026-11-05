import { type ReactNode, useId } from 'react'
import styles from '@/platform/design-system/components/field/field.module.css'
import { Input, TextArea } from '@/platform/design-system/components/field/inputs'
import { Select } from '@/platform/design-system/components/picker/select'

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

interface TextValueProps {
  value?: string
  onChange?: (value: string) => void
}

interface TextFieldProps extends FieldProps, TextValueProps {
  required?: boolean
  pattern?: string
  placeholder?: string
}

export function TextField({
  label,
  optional,
  error,
  disabled,
  name,
  defaultValue,
  value,
  onChange,
  placeholder,
  required,
  pattern,
}: TextFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error}>
      <Input
        id={id}
        required={required}
        pattern={pattern}
        label={label}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
      />
    </FieldFrame>
  )
}

interface TextAreaFieldProps extends FieldProps, TextValueProps {
  placeholder?: string
}

export function TextAreaField({
  label,
  optional,
  error,
  disabled,
  name,
  defaultValue,
  value,
  onChange,
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
        value={value}
        onChange={onChange}
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
