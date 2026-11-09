import { type ComponentProps, useId } from 'react'
import styles from '#emcn/components/field/field.shared.module.css'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import {
  Input,
  TextArea,
  type TextEntryProps,
  type TextValueProps,
} from '#emcn/components/field/inputs'
import { Select } from '#emcn/components/picker/select'
import { Switch } from '#emcn/components/switch/switch'

interface FieldProps {
  label: string
  optional?: boolean
  error?: string
  hint?: string
  disabled?: boolean
  name?: string
  defaultValue?: string
}

interface TextFieldProps extends FieldProps, TextValueProps, TextEntryProps {
  required?: boolean
  pattern?: string
  placeholder: string
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
  viewOnly,
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
        viewOnly={viewOnly}
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
  placeholder: string
  autoComplete?: string
  spellCheck?: boolean
  required?: boolean
  maxLength?: number
  readOnly?: boolean
  viewOnly?: boolean
  defaultSize?: ComponentProps<typeof TextArea>['defaultSize']
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
  viewOnly,
  defaultSize,
  autoComplete,
  spellCheck,
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <TextArea
        id={id}
        required={required}
        maxLength={maxLength}
        readOnly={readOnly}
        viewOnly={viewOnly}
        defaultSize={defaultSize}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
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

interface SelectFieldProps<Value extends string = string> extends FieldProps {
  options: ReadonlyArray<{
    value: Value
    label: string
    disabled?: boolean
    disabledReason?: string
  }>
  disabledReason?: string
  value?: Value
  onValueChange?: (value: Value) => void
  /** Shown in secondary ink until something is chosen, such as "Select Notion account". */
  placeholder?: string
}

export function SelectField<Value extends string>({
  label,
  optional,
  error,
  hint,
  disabled,
  disabledReason,
  name,
  defaultValue,
  options,
  value,
  onValueChange,
  placeholder,
}: SelectFieldProps<Value>) {
  const id = useId()
  return (
    <Select
      id={id}
      label={label}
      name={name}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      options={options}
      disabled={disabled}
      disabledReason={disabledReason}
      invalid={Boolean(error)}
      describedBy={fieldDescription(id, error, hint)}
      field={{ optional, error, hint }}
    />
  )
}

interface SwitchFieldProps {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A setting that applies with its switch: the caption on the leading edge names and toggles it. */
export function SwitchField({ label, checked, disabled, onCheckedChange }: SwitchFieldProps) {
  const id = useId()
  return (
    <div className={styles.switchField}>
      <label htmlFor={id} data-type='T059'>
        {label}
      </label>
      <Switch
        id={id}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}
