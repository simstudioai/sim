'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { StatusTag } from '@sim/emcn/status'
import { BrandMark } from '@/app/(product)/_components/brand-mark/brand-mark'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/byok.module.css'
import {
  PROVIDER_SECTIONS,
  PROVIDERS,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/providers'
import { type BYOKProviderId, MAX_BYOK_KEYS_PER_PROVIDER } from '@/platform/lib/data/byok'
import { plural } from '@/platform/shared/plural'

/** A stored key, in rotation order within its provider. */
export interface ByokManagerKey {
  id: string
  name: string | null
  maskedKey: string
}

/** Independent key-management actions open to the viewer. */
export interface ByokManagerCapabilities {
  add: boolean
  update: boolean
  delete: boolean
}

interface SaveKeyParams {
  providerId: BYOKProviderId
  apiKey: string
  keyId?: string
  name: string
}

/** What both the provider list and one provider's keys need to add, replace and delete keys. */
export interface ByokKeyActions {
  keysByProvider: ReadonlyMap<string, readonly ByokManagerKey[]>
  capabilities: ByokManagerCapabilities
  /** Usage copy that replaces the key dialog's default. */
  keyUsageDescription?: string
  /** The consequence of deleting a provider's last key. */
  lastKeyDeleteMessage: string
  isDeleting: boolean
  onSaveKey: (params: SaveKeyParams) => Promise<void>
  onDeleteKey: (providerId: BYOKProviderId, keyId: string) => Promise<void>
}

type ByokProvider = (typeof PROVIDERS)[number]

const NO_KEYS: readonly ByokManagerKey[] = []

function providerName(providerId: BYOKProviderId): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.name ?? 'provider'
}

interface KeyDialogProps {
  provider: ByokProvider
  /** The key being replaced; absent when adding one. */
  existing?: ByokManagerKey
  description?: string
  onSave: (params: SaveKeyParams) => Promise<void>
  onClose: () => void
}

/** Adds a provider key or replaces one's secret, holding its own draft. */
function KeyDialog({ provider, existing, description, onSave, onClose }: KeyDialogProps) {
  const [apiKey, setApiKey] = useState('')
  const [name, setName] = useState(existing?.name ?? '')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${existing ? 'Update' : 'Add'} ${provider.name} API key`}
      description={
        description ?? `Requests round-robin across every ${provider.name} key, stored encrypted`
      }
      confirmLabel='Save'
      confirmDisabled={!apiKey.trim()}
      submitOnEnter
      onConfirm={() =>
        onSave({
          providerId: provider.id,
          apiKey: apiKey.trim(),
          keyId: existing?.id,
          name: name.trim(),
        })
      }
    >
      <AutofillDecoys />
      <FieldStack>
        <SecretField
          label='API key'
          required
          name='byok_api_key'
          placeholder={provider.placeholder}
          value={apiKey}
          onChange={setApiKey}
        />
        <TextField
          label='Name'
          optional
          placeholder='e.g. Production key'
          maxLength={120}
          value={name}
          onChange={setName}
        />
      </FieldStack>
    </Modal>
  )
}

interface DeleteTarget {
  providerId: BYOKProviderId
  keyId: string
}

/** The add or update dialog and the delete confirm, opened from a provider row or its keys. */
function useKeyDialogs({
  keysByProvider,
  capabilities,
  keyUsageDescription,
  lastKeyDeleteMessage,
  isDeleting,
  onSaveKey,
  onDeleteKey,
}: ByokKeyActions) {
  const [editing, setEditing] = useState<{
    provider: ByokProvider
    key?: ByokManagerKey
  } | null>(null)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const providerKeys = (providerId: string) => keysByProvider.get(providerId) ?? NO_KEYS

  const dialogs = (
    <>
      {editing && (
        <KeyDialog
          provider={editing.provider}
          existing={editing.key}
          description={keyUsageDescription}
          onSave={onSaveKey}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        title={(target) => `Delete ${providerName(target.providerId)} key`}
        description={(target) => {
          const consequence =
            providerKeys(target.providerId).length === 1
              ? lastKeyDeleteMessage
              : `Requests will continue using the remaining ${providerName(target.providerId)} keys.`
          return `${consequence} This action cannot be undone.`
        }}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        confirmDisabled={!capabilities.delete}
        pending={isDeleting}
        onConfirm={(target) => onDeleteKey(target.providerId, target.keyId)}
      />
    </>
  )

  return {
    providerKeys,
    edit: (provider: ByokProvider, key?: ByokManagerKey) => setEditing({ provider, key }),
    remove: setDeleting,
    dialogs,
  }
}

interface ByokProviderListProps {
  actions: ByokKeyActions
  /** Providers whose key this workspace inherits from its organization. */
  inheritedProviderIds: ReadonlySet<BYOKProviderId>
  searchTerm: string
  onOpenProvider: (providerId: BYOKProviderId) => void
}

/**
 * Providers grouped by kind. A provider with no key adds one in place; one with keys opens its
 * pool as a sub-view.
 */
export function ByokProviderList({
  inheritedProviderIds,
  searchTerm,
  onOpenProvider,
  actions,
}: ByokProviderListProps) {
  const { capabilities } = actions
  const { providerKeys, edit, dialogs } = useKeyDialogs(actions)
  const canManageKeys = capabilities.add || capabilities.update || capabilities.delete

  const term = searchTerm.trim().toLowerCase()
  const visibleSections = PROVIDER_SECTIONS.map((section) => ({
    label: section.label,
    rows: PROVIDERS.filter(
      (provider) =>
        section.ids.includes(provider.id) &&
        (!term ||
          provider.name.toLowerCase().includes(term) ||
          provider.description.toLowerCase().includes(term))
    ),
  })).filter((section) => section.rows.length > 0)

  return (
    <>
      {visibleSections.length === 0 ? (
        <EmptyState title='No matching providers' />
      ) : (
        visibleSections.map((section) => (
          <SettingsSection key={section.label} title={section.label}>
            {section.rows.map((provider) => {
              const keys = providerKeys(provider.id)
              const inherited = inheritedProviderIds.has(provider.id)
              return (
                <SettingsRow
                  key={provider.id}
                  label={provider.name}
                  description={provider.description}
                  leading={<BrandMark providerId={provider.id} icon={provider.icon} />}
                >
                  {(inherited || keys.length > 0 || capabilities.add) && (
                    <>
                      {inherited && <StatusTag label='Inherited from organization' />}
                      {keys.length === 0 ? (
                        capabilities.add && (
                          <Button size='compact' onClick={() => edit(provider)}>
                            Add key
                          </Button>
                        )
                      ) : (
                        <>
                          <span className={styles.count} data-type='T060'>
                            {plural(keys.length, 'key')}
                          </span>
                          <Button size='compact' onClick={() => onOpenProvider(provider.id)}>
                            {canManageKeys ? 'Manage' : 'View'}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </SettingsRow>
              )
            })}
          </SettingsSection>
        ))
      )}
      {dialogs}
    </>
  )
}

interface ByokProviderKeysProps {
  actions: ByokKeyActions
  providerId: BYOKProviderId
  onBack: () => void
}

/** One provider's pool of keys: replace or delete each, and add one up to the provider's limit. */
export function ByokProviderKeys({ providerId, onBack, actions }: ByokProviderKeysProps) {
  const { capabilities } = actions
  const { providerKeys, edit, remove, dialogs } = useKeyDialogs(actions)
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId)
  if (!provider) return null
  const keys = providerKeys(provider.id)
  const addKey = capabilities.add ? (
    <Button
      size='compact'
      icon='I074'
      disabled={keys.length >= MAX_BYOK_KEYS_PER_PROVIDER}
      disabledReason='Key limit reached'
      onClick={() => edit(provider)}
    >
      Add key
    </Button>
  ) : undefined

  return (
    <SectionStack>
      <DetailHeader
        backLabel='BYOK'
        onBack={onBack}
        title={provider.name}
        description='Requests round-robin across these keys, stored encrypted'
      />
      <SettingsList
        title='Keys'
        empty={keys.length === 0 ? { title: 'No keys yet', action: addKey } : undefined}
      >
        {keys.map((key) => (
          <SettingsRow key={key.id} label={key.name ?? 'Unnamed key'} description={key.maskedKey}>
            {(capabilities.update || capabilities.delete) && (
              <>
                {capabilities.update && (
                  <Button size='compact' onClick={() => edit(provider, key)}>
                    Update
                  </Button>
                )}
                {capabilities.delete && (
                  <Button
                    size='compact'
                    variant='quiet'
                    destructive
                    onClick={() => remove({ providerId: provider.id, keyId: key.id })}
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </SettingsRow>
        ))}
        {addKey && (
          <SettingsRow
            label='New key'
            description={`Up to ${plural(MAX_BYOK_KEYS_PER_PROVIDER, 'key')} per provider`}
          >
            {addKey}
          </SettingsRow>
        )}
      </SettingsList>
      {dialogs}
    </SectionStack>
  )
}
