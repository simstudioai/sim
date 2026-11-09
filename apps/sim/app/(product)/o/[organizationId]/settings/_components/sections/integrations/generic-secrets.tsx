'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow } from '@sim/emcn/settings-section'
import Link from 'next/link'
import { ActionRow, Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  type GenericSecretSource,
  type SecretSourceMode,
  useGenericSecretSourceRemoval,
  useGenericSecretSourceSetup,
} from '@/platform/lib/data/search-sources'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

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
      confirmLabel={setup.pending ? 'Saving' : source ? 'Save' : 'Add source'}
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

interface GenericSecretSourceRowProps {
  organizationId: string
  source: GenericSecretSource
}

export function GenericSecretSourceRow({ organizationId, source }: GenericSecretSourceRowProps) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const remove = useGenericSecretSourceRemoval(organizationId)
  const surface = useSurfaceScope()
  return (
    <>
      <SettingsRow
        label={GENERIC_SECRETS_NAME}
        description={source.mode === 'organization' ? 'Organization' : 'Member'}
        leading={<Icon name='I070' />}
      >
        <ActionRow>
          {source.mode === 'organization' && (
            <Button
              size='compact'
              render={<Link href={surfaceHref(surface, '/settings/integrations/secrets')} />}
            >
              Secrets
            </Button>
          )}
          <Button size='compact' onClick={() => setEditing(true)}>
            Configure
          </Button>
          <ActionMenu
            label='Generic Secrets source actions'
            icon='I108'
            actions={[
              {
                id: 'remove',
                label: 'Remove source',
                destructive: true,
                onSelect: () => setRemoving(true),
              },
            ]}
          />
        </ActionRow>
      </SettingsRow>
      {editing && (
        <GenericSecretSourceModal
          organizationId={organizationId}
          source={source}
          onClose={() => setEditing(false)}
        />
      )}
      {removing && (
        <ConfirmDialog
          target
          onClose={() => setRemoving(false)}
          title='Remove Generic Secrets source?'
          confirmLabel='Remove source'
          pendingLabel='Removing…'
          onConfirm={() => remove(source.id)}
        >
          <Muted>This deletes its organization and member secrets.</Muted>
        </ConfirmDialog>
      )}
    </>
  )
}
