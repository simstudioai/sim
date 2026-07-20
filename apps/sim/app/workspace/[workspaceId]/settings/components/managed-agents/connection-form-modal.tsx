'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'

export interface ConnectionFormValues {
  name: string
  apiKey: string
}

interface ConnectionFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ConnectionFormValues) => Promise<void>
}

/**
 * "Link Claude workspace" dialog. User enters a display name + an
 * Anthropic API key. Submission triggers a verify-then-save flow on the
 * server; the modal keeps the dialog open until the request resolves so
 * verification errors surface inline.
 */
export function ConnectionFormModal({
  open,
  onOpenChange,
  onSubmit,
}: ConnectionFormModalProps) {
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setName('')
      setApiKey('')
      setError(null)
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    const trimmedKey = apiKey.trim()
    if (!trimmedName) {
      setError('Give this connection a name (e.g. "prod", "staging").')
      return
    }
    if (!trimmedKey) {
      setError('Anthropic API key is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ name: trimmedName, apiKey: trimmedKey })
      onOpenChange(false)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to link the Claude workspace.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Link Claude workspace' size='md'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Link Claude workspace</ChipModalHeader>

      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={(value) => {
            setName(value)
            if (error) setError(null)
          }}
          placeholder='prod, staging, my-team, …'
          required
          hint='A label you’ll see when picking connections from a workflow block.'
        />

        <ChipModalField
          type='input'
          title='Anthropic API key'
          value={apiKey}
          onChange={(value) => {
            setApiKey(value)
            if (error) setError(null)
          }}
          placeholder='sk-ant-…'
          password
          required
          hint='The workspace key from Claude Platform. Verified against /v1/agents before saving.'
        />

        <ChipModalError>{error ?? undefined}</ChipModalError>
      </ChipModalBody>

      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={submitting}
        primaryAction={{
          label: submitting ? 'Verifying…' : 'Link & save',
          onClick: handleSubmit,
          disabled: submitting || !name.trim() || !apiKey.trim(),
        }}
      />
    </ChipModal>
  )
}
