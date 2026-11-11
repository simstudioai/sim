'use client'

import { useState } from 'react'
import { FieldFrame } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import {
  type GenericSecretSource,
  type SecretSourceMode,
  useGenericSecretSourceSetup,
} from '@/platform/lib/data/search-sources'

export const GENERIC_SECRETS_SOURCE_TYPE = 'generic-secrets'
export const GENERIC_SECRETS_NAME = 'Generic Secrets'

interface GenericSecretSourceModalProps {
  organizationId: string
  source: GenericSecretSource | null
  onClose: () => void
}

export function GenericSecretSourceModal({
  organizationId,
  source,
  onClose,
}: GenericSecretSourceModalProps) {
  const [mode, setMode] = useState<SecretSourceMode>(source?.mode ?? 'organization')
  const setup = useGenericSecretSourceSetup(organizationId)
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={GENERIC_SECRETS_NAME}
      confirmLabel={setup.pending ? 'Saving…' : source ? 'Save' : 'Add source'}
      confirmDisabled={setup.pending}
      onConfirm={() => setup.save(source?.id ?? null, mode)}
    >
      <FieldFrame label='Mode'>
        <SegmentedControl
          label='Mode'
          value={mode}
          onSelect={setMode}
          options={[
            { value: 'organization', label: 'Organization' },
            { value: 'member', label: 'Member' },
          ]}
        />
      </FieldFrame>
    </Modal>
  )
}
