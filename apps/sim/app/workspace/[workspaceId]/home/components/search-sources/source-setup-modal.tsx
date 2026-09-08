'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { SearchConnector } from '@/lib/sim-search/connectors'

interface SourceSetupModalProps {
  connector: SearchConnector
  onClose: () => void
  isPending?: boolean
  error?: string | null
  /** Connects the source with the filled-in fields; the caller opens the OAuth tab in this click. */
  onConnect: (sourceConfig: Record<string, string>) => void
}

/**
 * The few fields a source needs before its first connect, such as a site and
 * a space. Everyone after the first person clicks straight through.
 */
export function SourceSetupModal({
  connector,
  onClose,
  onConnect,
  isPending = false,
  error,
}: SourceSetupModalProps) {
  const docsUrl = connector.meta.searchDocsUrl
  const fields = connector.setupFields
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = fields.every((field) => values[field.id]?.trim())

  const submit = () => {
    if (!complete || isPending) return
    onConnect(Object.fromEntries(fields.map((field) => [field.id, values[field.id]?.trim() ?? ''])))
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      srTitle={`Connect ${connector.meta.name}`}
    >
      <ChipModalHeader onClose={onClose}>Connect {connector.meta.name}</ChipModalHeader>
      <ChipModalBody>
        {fields.map((field) =>
          field.type === 'dropdown' ? (
            <ChipModalField
              key={field.id}
              type='dropdown'
              title={field.title}
              value={values[field.id]}
              onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
              options={(field.options ?? []).map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              placeholder={field.placeholder}
              hint={field.description}
              required
            />
          ) : (
            <ChipModalField
              key={field.id}
              type='input'
              title={field.title}
              value={values[field.id] ?? ''}
              onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
              placeholder={field.placeholder}
              hint={field.description}
              autoComplete='off'
              required
            />
          )
        )}
        {error && (
          <p role='alert' className='px-2 text-[var(--text-error)] text-caption'>
            {error}
          </p>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        secondaryActions={
          docsUrl
            ? [
                {
                  label: 'Setup guide',
                  onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
                },
              ]
            : undefined
        }
        primaryAction={{
          label: isPending ? 'Connecting…' : 'Connect',
          onClick: submit,
          disabled: !complete || isPending,
        }}
      />
    </ChipModal>
  )
}
