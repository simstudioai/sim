import { type ComponentProps, useId } from 'react'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import {
  Input,
  TextArea,
  type TextEntryProps,
  type TextValueProps,
} from '#emcn/components/field/inputs'
import { Select } from '#emcn/components/picker/select'

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

interface SelectFieldProps extends FieldProps {
  options: ComponentProps<typeof Select>['options']
  disabledReason?: string
  value?: string
  onValueChange?: (value: string) => void
}

export function SelectField({
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
}: SelectFieldProps) {
  const id = useId()
  return (
    <Select
      id={id}
      label={label}
      name={name}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      options={options}
      disabled={disabled}
      disabledReason={disabledReason}
      invalid={Boolean(error)}
      describedBy={fieldDescription(id, error, hint)}
      field={{ optional, error, hint }}
    />
  )
}
