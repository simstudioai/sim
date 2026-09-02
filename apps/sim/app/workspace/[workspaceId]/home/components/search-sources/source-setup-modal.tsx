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
import type { ConnectorConfigField } from '@/connectors/types'

interface SourceSetupModalProps {
  connector: SearchConnector
  fields: readonly ConnectorConfigField[]
  onOpenChange: (open: boolean) => void
  /** Connects the source with the filled-in fields; the caller opens the OAuth tab in this click. */
  onConnect: (sourceConfig: Record<string, string>) => void
}

/**
 * The few fields a source needs before its first connect, such as a site and
 * a space. Everyone after the first person clicks straight through.
 */
export function SourceSetupModal({
  connector,
  fields,
  onOpenChange,
  onConnect,
}: SourceSetupModalProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = fields.every((field) => values[field.id]?.trim())

  const submit = () => {
    if (!complete) return
    onConnect(Object.fromEntries(fields.map((field) => [field.id, values[field.id]?.trim() ?? ''])))
    onOpenChange(false)
  }

  return (
    <ChipModal open onOpenChange={onOpenChange} srTitle={`Connect ${connector.meta.name}`}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        Connect {connector.meta.name}
      </ChipModalHeader>
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
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        primaryAction={{ label: 'Connect', onClick: submit, disabled: !complete }}
      />
    </ChipModal>
  )
}
