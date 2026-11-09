'use client'

import { SecretField } from '@sim/emcn/field/value-fields'

interface ApiKeyFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}

/** A Search connection's API key, kept write-only in the browser. */
export function ApiKeyField({ label, value, onChange, placeholder, disabled }: ApiKeyFieldProps) {
  return (
    <SecretField
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete='new-password'
      disabled={disabled}
    />
  )
}
