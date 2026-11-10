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
import {
  FieldStack,
  Muted,
  RowStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/byok.module.css'
import {
  PROVIDER_SECTIONS,
  PROVIDERS,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/providers'
import { type BYOKProviderId, MAX_BYOK_KEYS_PER_PROVIDER } from '@/platform/lib/data/byok'

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

interface ByokKeyManagerProps {
  /** Providers whose key this workspace inherits from its organization. */
  inheritedProviderIds: ReadonlySet<BYOKProviderId>
  keysByProvider: ReadonlyMap<string, readonly ByokManagerKey[]>
  capabilities: ByokManagerCapabilities
  searchTerm: string
  /** Where the key is exposed beyond this dialog's scope, shown under the key dialog's title. */
  keyUsageDescription?: string
  /** The consequence of deleting a provider's last key. */
  lastKeyDeleteMessage: string
  isDeleting: boolean
  onSaveKey: (params: {
    providerId: BYOKProviderId
    apiKey: string
    keyId?: string
    name: string
  }) => Promise<void>
  onDeleteKey: (providerId: BYOKProviderId, keyId: string) => Promise<void>
}

interface EditingState {
  providerId: BYOKProviderId
  /** Set when updating an existing key. */
  keyId?: string
}

const NO_KEYS: readonly ByokManagerKey[] = []

/**
 * Provider keys grouped by kind, each provider with a pool of keys requests round-robin across:
 * add, update and delete keys, and see a provider's pool in its own dialog.
 */
export function ByokKeyManager({
  inheritedProviderIds,
  keysByProvider,
  capabilities,
  searchTerm,
  keyUsageDescription,
  lastKeyDeleteMessage,
  isDeleting,
  onSaveKey,
  onDeleteKey,
}: ByokKeyManagerProps) {
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<Required<EditingState> | null>(null)
  const [managingProviderId, setManagingProviderId] = useState<BYOKProviderId | null>(null)

  const term = searchTerm.trim().toLowerCase()
  const filteredIds = new Set(
    PROVIDERS.filter(
      (provider) =>
        !term ||
        provider.name.toLowerCase().includes(term) ||
        provider.description.toLowerCase().includes(term)
    ).map((provider) => provider.id)
  )
  const providerKeys = (providerId: string) => keysByProvider.get(providerId) ?? NO_KEYS
  const editingMeta = PROVIDERS.find((provider) => provider.id === editing?.providerId)
  const managingMeta = PROVIDERS.find((provider) => provider.id === managingProviderId)
  const managingKeys = managingProviderId ? providerKeys(managingProviderId) : NO_KEYS
  const isUpdatingExistingKey = Boolean(editing?.keyId)
  const canSaveEditingKey = isUpdatingExistingKey ? capabilities.update : capabilities.add
  const canManageKeys = capabilities.add || capabilities.update || capabilities.delete

  const openEditModal = (providerId: BYOKProviderId, key?: ByokManagerKey) => {
    if (key ? !capabilities.update : !capabilities.add) return
    setManagingProviderId(null)
    setEditing({ providerId, keyId: key?.id })
    setApiKeyInput('')
    setNameInput(key?.name ?? '')
  }

  const openDeleteConfirm = (providerId: BYOKProviderId, keyId: string) => {
    if (!capabilities.delete) return
    setManagingProviderId(null)
    setDeleteConfirm({ providerId, keyId })
  }

  const handleSave = async () => {
    if (!editing || !apiKeyInput.trim() || !canSaveEditingKey) return false
    await onSaveKey({
      providerId: editing.providerId,
      apiKey: apiKeyInput.trim(),
      keyId: editing.keyId,
      name: nameInput.trim(),
    })
  }

  const visibleSections = PROVIDER_SECTIONS.map((section) => ({
    label: section.label,
    rows: PROVIDERS.filter(
      (provider) => section.ids.includes(provider.id) && filteredIds.has(provider.id)
    ),
  })).filter((section) => section.rows.length > 0)

  return (
    <>
      {visibleSections.length === 0 ? (
        <EmptyState title={`No providers found matching "${searchTerm}"`} />
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
                    <span className={styles.controls}>
                      {inherited && <StatusTag label='Inherited from organization' />}
                      {keys.length === 0 ? (
                        capabilities.add && (
                          <Button
                            size='compact'
                            variant='primary'
                            onClick={() => openEditModal(provider.id)}
                          >
                            Add key
                          </Button>
                        )
                      ) : (
                        <>
                          <span className={styles.count} data-type='T060'>
                            {keys.length} {keys.length === 1 ? 'key' : 'keys'}
                          </span>
                          <Button size='compact' onClick={() => setManagingProviderId(provider.id)}>
                            {canManageKeys ? 'Manage' : 'View'}
                          </Button>
                        </>
                      )}
                    </span>
                  )}
                </SettingsRow>
              )
            })}
          </SettingsSection>
        ))
      )}

      <Modal
        open={managingProviderId !== null}
        onOpenChange={(open) => {
          if (!open) setManagingProviderId(null)
        }}
        title={managingMeta ? `${managingMeta.name} API Keys` : 'API Keys'}
        confirmLabel={capabilities.add ? 'Add key' : undefined}
        confirmDisabled={managingKeys.length >= MAX_BYOK_KEYS_PER_PROVIDER}
        onConfirm={() => {
          if (managingProviderId) openEditModal(managingProviderId)
        }}
      >
        <RowStack>
          {managingKeys.map((key) => (
            <SettingsRow key={key.id} label={key.name ?? 'Unnamed key'} description={key.maskedKey}>
              {(capabilities.update || capabilities.delete) && managingProviderId && (
                <span className={styles.controls}>
                  {capabilities.update && (
                    <Button size='compact' onClick={() => openEditModal(managingProviderId, key)}>
                      Update
                    </Button>
                  )}
                  {capabilities.delete && (
                    <Button
                      size='compact'
                      variant='quiet'
                      destructive
                      onClick={() => openDeleteConfirm(managingProviderId, key.id)}
                    >
                      Delete
                    </Button>
                  )}
                </span>
              )}
            </SettingsRow>
          ))}
        </RowStack>
        {capabilities.add && managingKeys.length >= MAX_BYOK_KEYS_PER_PROVIDER && (
          <Muted>{`Key limit reached (${MAX_BYOK_KEYS_PER_PROVIDER} keys per provider).`}</Muted>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title={
          editingMeta
            ? `${isUpdatingExistingKey ? 'Update' : 'Add'} ${editingMeta.name} API Key`
            : 'API Key'
        }
        description={keyUsageDescription}
        confirmLabel='Save'
        confirmDisabled={!apiKeyInput.trim() || !canSaveEditingKey}
        submitOnEnter
        onConfirm={handleSave}
      >
        <AutofillDecoys />
        <FieldStack>
          <SecretField
            label='API Key'
            required
            name='byok_api_key'
            placeholder={editingMeta?.placeholder ?? ''}
            value={apiKeyInput}
            onChange={setApiKeyInput}
          />
          <TextField
            label='Name'
            optional
            placeholder='e.g. Production key'
            maxLength={120}
            value={nameInput}
            onChange={setNameInput}
          />
        </FieldStack>
      </Modal>

      <ConfirmDialog
        target={deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title='Delete API key'
        description={(target) => {
          const name = PROVIDERS.find((provider) => provider.id === target.providerId)?.name
          const consequence =
            providerKeys(target.providerId).length === 1
              ? lastKeyDeleteMessage
              : `Requests will continue using the remaining ${name ?? 'provider'} keys.`
          return `Are you sure you want to delete the ${name ?? 'selected'} API key? ${consequence} This action cannot be undone.`
        }}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        confirmDisabled={!capabilities.delete}
        pending={isDeleting}
        onConfirm={(target) => onDeleteKey(target.providerId, target.keyId)}
      />
    </>
  )
}
