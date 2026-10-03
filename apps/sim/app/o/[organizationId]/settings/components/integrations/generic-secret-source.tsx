'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSwitch,
  toast,
} from '@sim/emcn'
import { KeySquare } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { GenericSecretSource } from '@/lib/api/contracts/organization-secrets'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useConfigureOrganizationSecretSource,
  useRemoveOrganizationSecretSource,
} from '@/hooks/queries/organization-secrets'

export const GENERIC_SECRETS_SOURCE_TYPE = 'generic-secrets'
export const GENERIC_SECRETS_META = { name: 'Generic Secrets', icon: KeySquare }

/** Generic secrets belong to the organization rather than an external provider. */
export function GenericSecretSourceIcon() {
  const { organization } = useOrganizationContext()
  return (
    <IdentityTile
      size='lg'
      initial={(organization.name.trim()[0] || 'O').toUpperCase()}
      logoUrl={organization.logo}
      alt={organization.name}
    />
  )
}

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
  const close = () => {
    if (!update.isPending) onClose()
  }
  return (
    <ChipModal
      open
      dismissDisabled={update.isPending}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      srTitle='Generic Secrets'
    >
      <ChipModalHeader onClose={close}>Generic Secrets</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Mode'>
          <ChipSwitch
            aria-label='Mode'
            value={mode}
            onChange={setMode}
            disabled={update.isPending}
            options={[
              { value: 'organization', label: 'Organization' },
              { value: 'member', label: 'Member' },
            ]}
          />
        </ChipModalField>
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        primaryAction={{
          label: update.isPending ? 'Saving' : source ? 'Save' : 'Add source',
          disabled: update.isPending,
          onClick: () =>
            update.mutate(
              { sourceId: source?.id ?? null, mode },
              {
                onSuccess: () => {
                  onClose()
                  if (mode === 'organization')
                    router.push(organizationRoutes(organizationId).organizationSecrets)
                },
              }
            ),
        }}
      />
    </ChipModal>
  )
}

interface GenericSecretSourceRowProps {
  organizationId: string
  source: GenericSecretSource
  admin?: boolean
}

export function GenericSecretSourceRow({
  organizationId,
  source,
  admin = false,
}: GenericSecretSourceRowProps) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const remove = useRemoveOrganizationSecretSource(organizationId)
  const routes = organizationRoutes(organizationId)
  return (
    <>
      <SettingsResourceRow
        iconVariant='custom'
        icon={<GenericSecretSourceIcon />}
        title='Generic Secrets'
        description={source.mode === 'organization' ? 'Organization' : 'Member'}
        trailing={
          <div className='flex gap-2'>
            {admin ? (
              <>
                {source.mode === 'organization' && (
                  <ChipLink href={routes.organizationSecrets}>Secrets</ChipLink>
                )}
                <Chip onClick={() => setEditing(true)}>Configure</Chip>
                <RowActionsMenu
                  label='Generic Secrets source actions'
                  actions={[
                    {
                      label: 'Remove source',
                      destructive: true,
                      onSelect: () => setRemoving(true),
                    },
                  ]}
                />
              </>
            ) : source.mode === 'member' ? (
              <ChipLink href={routes.memberSecrets}>Manage secrets</ChipLink>
            ) : (
              <span className='text-[var(--text-muted)] text-small'>Organization managed</span>
            )}
          </div>
        }
      />
      {editing && (
        <GenericSecretSourceModal
          organizationId={organizationId}
          source={source}
          onClose={() => setEditing(false)}
        />
      )}
      <ChipConfirmModal
        open={removing}
        onOpenChange={(open) => {
          if (!remove.isPending) setRemoving(open)
        }}
        title='Remove Generic Secrets source?'
        text='This deletes its organization and member secrets.'
        confirm={{
          label: 'Remove source',
          variant: 'destructive',
          pending: remove.isPending,
          onClick: () =>
            remove.mutate(source.id, {
              onSuccess: () => setRemoving(false),
              onError: (error) => toast.error(error.message),
            }),
        }}
      />
    </>
  )
}
