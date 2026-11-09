'use client'

import { useEffect, useRef, useState } from 'react'
import { SecretField } from '@sim/emcn/field/value-fields'
import { EnvVarDropdown } from '@/app/(product)/workspace/[workspaceId]/_components/env-var-dropdown/env-var-dropdown'
import { checkEnvVarTrigger } from '@/platform/lib/data/credentials'

interface ConnectorApiKeyFieldProps {
  workspaceId: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  optional?: boolean
  required?: boolean
  disabled?: boolean
}

/**
 * A connector's API key, which may be a `{{SECRET}}` reference: typing `{{` offers the workspace's
 * and the viewer's secret names at the caret, and choosing one writes the reference in place.
 */
export function ConnectorApiKeyField({
  workspaceId,
  label,
  placeholder,
  value,
  onChange,
  optional,
  required,
  disabled,
}: ConnectorApiKeyFieldProps) {
  const input = useRef<HTMLInputElement | null>(null)
  /** The caret the suggestions follow; `null` once they are dismissed or a secret is chosen. */
  const [caret, setCaret] = useState<number | null>(null)
  const trigger = caret === null ? null : checkEnvVarTrigger(value, caret)
  const suggesting = Boolean(trigger?.show)

  /**
   * While suggestions show, Escape closes them rather than the dialog and Enter never submits it.
   * The suggestions read their own keys only while they list a secret, so the field holds these two.
   */
  useEffect(() => {
    const element = input.current
    if (!suggesting || !element) return
    const holdKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setCaret(null)
      } else if (event.key === 'Enter') event.preventDefault()
    }
    element.addEventListener('keydown', holdKeys)
    return () => element.removeEventListener('keydown', holdKeys)
  }, [suggesting])

  return (
    <>
      <SecretField
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(next) => {
          onChange(next)
          setCaret(input.current?.selectionStart ?? next.length)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        inputRef={input}
        optional={optional}
        required={required}
        autoComplete='new-password'
        disabled={disabled}
      />
      {trigger && suggesting && caret !== null && (
        <EnvVarDropdown
          visible
          searchTerm={trigger.searchTerm}
          inputValue={value}
          cursorPosition={caret}
          workspaceId={workspaceId}
          inputRef={input}
          onClose={() => setCaret(null)}
          onSelect={(next, cursor) => {
            onChange(next)
            setCaret(null)
            requestAnimationFrame(() => {
              input.current?.focus()
              input.current?.setSelectionRange(cursor, cursor)
            })
          }}
        />
      )}
    </>
  )
}
