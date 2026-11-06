'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { GenericSecretSource } from '@/lib/api/contracts/organization-secrets'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  useConfigureOrganizationSecretSource,
  useRemoveOrganizationSecretSource,
} from '@/hooks/queries/organization-secrets'
import {
  ActionRow,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  ActionMenu,
  Avatar,
  Button,
  FieldFrame,
  Modal,
  SegmentedControl,
} from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'

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
  const update = useConfigureOrganizationSecretSource(organizationId)
  const router = useRouter()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={GENERIC_SECRETS_NAME}
      confirmLabel={update.isPending ? 'Saving' : source ? 'Save' : 'Add source'}
      confirmDisabled={update.isPending}
      onConfirm={async () => {
        await update.mutateAsync({ sourceId: source?.id ?? null, mode })
        if (mode === 'organization')
          router.push(organizationRoutes(organizationId).organizationSecrets)
      }}
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
  const { organization } = useOrganizationContext()
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const remove = useRemoveOrganizationSecretSource(organizationId)
  const routes = organizationRoutes(organizationId)
  return (
    <>
      <SettingsRow
        label={GENERIC_SECRETS_NAME}
        description={source.mode === 'organization' ? 'Organization' : 'Member'}
        leading={
          <Avatar name={organization.name} src={organization.logo ?? undefined} organization />
        }
      >
        <ActionRow>
          {source.mode === 'organization' && (
            <Button size='compact' render={<Link href={routes.organizationSecrets} />}>
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
        <Modal
          open
          variant='confirm'
          destructive
          onOpenChange={setRemoving}
          title='Remove Generic Secrets source?'
          confirmLabel='Remove source'
          onConfirm={async () => {
            try {
              await remove.mutateAsync(source.id)
            } catch (error) {
              toast.error(getErrorMessage(error, 'Could not remove the source'))
              return false
            }
          }}
        >
          <Muted>This deletes its organization and member secrets.</Muted>
        </Modal>
      )}
    </>
  )
}
