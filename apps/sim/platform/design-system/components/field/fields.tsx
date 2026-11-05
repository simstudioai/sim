import { type ReactNode, useId } from 'react'
import styles from '@/platform/design-system/components/field/field.module.css'
import {
  Input,
  TextArea,
  type TextEntryProps,
  type TextValueProps,
} from '@/platform/design-system/components/field/inputs'
import { Select } from '@/platform/design-system/components/picker/select'

interface FieldProps {
  label: string
  optional?: boolean
  error?: string
  hint?: string
  disabled?: boolean
  name?: string
  defaultValue?: string
}

interface FieldFrameProps {
  id?: string
  label: string
  optional?: boolean
  error?: string
  hint?: string
  /** Name the control for assistive technology only, where its context labels it visually. */
  labelHidden?: boolean
  children: ReactNode
}

/** The `aria-describedby` for a control whose frame was given this `error` and `hint`. */
export function fieldDescription(id: string, error?: string, hint?: string) {
  const parts = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

export function FieldFrame({
  id,
  label,
  optional,
  error,
  hint,
  labelHidden,
  children,
}: FieldFrameProps) {
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
        <label htmlFor={id} data-visually-hidden={labelHidden || undefined} data-type='T059'>
          {caption}
        </label>
      ) : (
        <span data-visually-hidden={labelHidden || undefined} data-type='T059'>
          {caption}
        </span>
      )}
      {children}
      {hint && (
        <span id={id ? `${id}-hint` : undefined} className={styles.hint} data-type='T052'>
          {hint}
        </span>
      )}
      {error && (
        <span id={id ? `${id}-error` : undefined} className={styles.error} data-type='T052'>
          {error}
        </span>
      )}
    </div>
  )
}

interface TextFieldProps extends FieldProps, TextValueProps, TextEntryProps {
  required?: boolean
  pattern?: string
  placeholder?: string
}

export function TextField({
  label,
  optional,
  error,
  hint,
  disabled,
  name,
  defaultValue,
  value,
  onChange,
  placeholder,
  required,
  pattern,
  type,
  inputMode,
  autoComplete,
  maxLength,
  readOnly,
}: TextFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        readOnly={readOnly}
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
        describedBy={fieldDescription(id, error, hint)}
      />
    </FieldFrame>
  )
}

interface TextAreaFieldProps extends FieldProps, TextValueProps {
  placeholder?: string
  required?: boolean
  maxLength?: number
  readOnly?: boolean
}

export function TextAreaField({
  label,
  optional,
  error,
  hint,
  disabled,
  name,
  defaultValue,
  value,
  onChange,
  placeholder,
  required,
  maxLength,
  readOnly,
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <TextArea
        id={id}
        required={required}
        maxLength={maxLength}
        readOnly={readOnly}
        label={label}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={fieldDescription(id, error, hint)}
      />
    </FieldFrame>
  )
}

interface SelectFieldProps extends FieldProps {
  options: ReadonlyArray<{ value: string; label: string }>
  value?: string
  onValueChange?: (value: string) => void
}

export function SelectField({
  label,
  optional,
  error,
  hint,
  disabled,
  name,
  defaultValue,
  options,
  value,
  onValueChange,
}: SelectFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <Select
        id={id}
        label={label}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onValueChange={onValueChange}
        options={options}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={fieldDescription(id, error, hint)}
      />
    </FieldFrame>
  )
}
