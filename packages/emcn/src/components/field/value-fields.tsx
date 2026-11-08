'use client'

import { type Ref, type SyntheticEvent, useId, useState } from 'react'
import { IconButton } from '#emcn/components/button/button'
import { CopyButton } from '#emcn/components/button/copy-button'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import { Input, type TextValueProps } from '#emcn/components/field/inputs'

interface CopyFieldProps {
  label: string
  value: string
  hint?: string
}

/** A value the viewer reads and copies, such as an endpoint or verification record. */
export function CopyField({ label, value, hint }: CopyFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} hint={hint}>
      <Input
        id={id}
        label={label}
        value={value}
        placeholder={label}
        viewOnly
        spellCheck={false}
        describedBy={fieldDescription(id, undefined, hint)}
      />
    </FieldFrame>
  )
}

interface SecretFieldProps extends TextValueProps {
  label: string
  defaultValue?: string
  name?: string
  placeholder: string
  optional?: boolean
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  error?: string
  hint?: string
  autoComplete?: string
  /** Offer a copy action while the field holds a controlled value. */
  copyable?: boolean
  /** A text input drawn as dots, which password managers leave alone as they do not a password one. */
  maskAsText?: boolean
  /** The input element, for a caller that anchors a caret popup such as secret suggestions. */
  inputRef?: Ref<HTMLInputElement>
  /** Caret moves without an edit (click, arrow keys), for the same caller. */
  onSelect?: (event: SyntheticEvent<HTMLInputElement>) => void
}

/** A masked credential the viewer can reveal, for entry or for one-time display. */
export function SecretField({
  label,
  value,
  defaultValue,
  onChange,
  name,
  placeholder,
  optional,
  required,
  disabled,
  readOnly,
  error,
  hint,
  autoComplete = 'off',
  copyable,
  maskAsText,
  inputRef,
  onSelect,
}: SecretFieldProps) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  return (
    <FieldFrame id={id} label={label} optional={optional} error={error} hint={hint}>
      <Input
        id={id}
        label={label}
        type={revealed || maskAsText ? 'text' : 'password'}
        masked={maskAsText && !revealed}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        name={name}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete={autoComplete}
        spellCheck={false}
        invalid={Boolean(error)}
        describedBy={fieldDescription(id, error, hint)}
        inputRef={inputRef}
        onSelect={onSelect}
        trailing={
          <>
            <IconButton
              label={`${revealed ? 'Hide' : 'Show'} ${label}`}
              icon={revealed ? 'eye-off' : 'eye'}
              size='compact'
              tooltip
              disabled={disabled}
              onClick={() => setRevealed((current) => !current)}
            />
            {copyable && value && (
              <CopyButton label={`Copy ${label}`} text={value} size='compact' />
            )}
          </>
        }
      />
    </FieldFrame>
  )
}
