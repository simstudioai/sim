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

interface RotateKeyModalProps {
  open: boolean
  connectionName: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (apiKey: string) => Promise<void>
}

/**
 * "Rotate API key" dialog. Same verify-then-save flow as the initial
 * link modal, but only the key field is editable — the connection name
 * stays put. Kept separate from the create modal so the wording and the
 * required fields match the operation the user is doing.
 */
export function RotateKeyModal({
  open,
  connectionName,
  onOpenChange,
  onSubmit,
}: RotateKeyModalProps) {
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setApiKey('')
      setError(null)
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setError('Anthropic API key is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(trimmedKey)
      onOpenChange(false)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to rotate the API key.'))
    } finally {
      setSubmitting(false)
    }
  }

  const title = connectionName ? `Rotate key — ${connectionName}` : 'Rotate API key'

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title} size='md'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{title}</ChipModalHeader>

      <ChipModalBody>
        <ChipModalField
          type='input'
          title='New Anthropic API key'
          value={apiKey}
          onChange={(value) => {
            setApiKey(value)
            if (error) setError(null)
          }}
          placeholder='sk-ant-…'
          password
          required
          hint='Verified against /v1/agents before saving. The old key is overwritten on success — existing workflows immediately use the new one.'
        />

        <ChipModalError>{error ?? undefined}</ChipModalError>
      </ChipModalBody>

      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={submitting}
        primaryAction={{
          label: submitting ? 'Verifying…' : 'Rotate & save',
          onClick: handleSubmit,
          disabled: submitting || !apiKey.trim(),
        }}
      />
    </ChipModal>
  )
}
