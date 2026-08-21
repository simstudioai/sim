'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  Button,
  Chip,
  ChipConfirmModal,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { Eye, EyeOff, Search } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  CHIP_FIELD_INPUT,
  CHIP_FIELD_SHELL,
} from '@/app/workspace/[workspaceId]/components/credential-detail/components/chip-field'
import { BYOKProviderKeysModal } from '@/app/workspace/[workspaceId]/settings/components/byok/byok-provider-keys-modal'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

const logger = createLogger('BYOKKeyManager')

export interface BYOKManagerProvider {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  placeholder: string
  /** Optional decorative status shown beside the provider row. */
  badge?: ReactNode
}

/** A stored key as rendered by the manager in multi-key mode. */
export interface BYOKManagerKey {
  id: string
  name: string | null
  maskedKey: string
}

/**
 * Optional provider grouping. Each provider id should belong to exactly one
 * section; rows keep their {@link BYOKKeyManagerBaseProps.providers} order
 * within a group. When omitted, providers render as a single flat list.
 */
export interface BYOKProviderSection {
  label: string
  ids: string[]
}

/** Independent key-management actions available to the current viewer. */
export interface BYOKManagerCapabilities {
  add: boolean
  update: boolean
  delete: boolean
}

interface BYOKKeyManagerBaseProps {
  /** Providers to render, in display order. */
  providers: BYOKManagerProvider[]
  isLoading: boolean
  isSaving?: boolean
  isDeleting?: boolean
  capabilities?: BYOKManagerCapabilities
  /** Labeled provider groups. When omitted, renders a single flat list. */
  sections?: BYOKProviderSection[]
  /** Optional subtitle shown above the provider list. */
  description?: string
  /** Human-readable scope used in key modal copy. */
  scopeLabel?: string
  /** Optional usage/security copy that replaces the add/update modal default. */
  keyUsageDescription?: string
  /** Consequence shown when deleting a provider's last stored key. */
  lastKeyDeleteMessage?: string
  /** Show the provider search box (hidden when there are only a couple). */
  showSearch?: boolean
  /**
   * Controlled search value + setter. The BYOK settings page passes the shared
   * `?search=` binding (`useSettingsSearch`) so the search is deep-linkable;
   * modal/embedded consumers omit both and keep local state.
   */
  searchTerm?: string
  onSearchTermChange?: (value: string) => void
}

/** One key per provider; saving replaces the stored key. */
interface BYOKSingleKeyModeProps {
  multiKey?: false
  /** Provider ids that currently have a stored key. */
  configuredProviderIds: Set<string>
  /** Persist a key. Throw to surface an error in the modal. */
  onSave: (providerId: string, apiKey: string) => Promise<void>
  /** Remove a key. */
  onDelete: (providerId: string) => Promise<void>
}

/** Multiple keys per provider; requests round-robin across them. */
interface BYOKMultiKeyModeProps {
  multiKey: true
  /** Stored keys grouped by provider id, in rotation order. */
  keysByProvider: ReadonlyMap<string, BYOKManagerKey[]>
  /** Maximum keys allowed per provider. */
  maxKeysPerProvider: number
  /**
   * Persist a key. `keyId` updates that key in place; otherwise a new key is
   * added. Throw to surface an error in the modal.
   */
  onSaveKey: (params: {
    providerId: string
    apiKey: string
    keyId?: string
    name: string
  }) => Promise<void>
  /** Remove a single key. */
  onDeleteKey: (providerId: string, keyId: string) => Promise<void>
}

type BYOKKeyManagerProps = BYOKKeyManagerBaseProps &
  (BYOKSingleKeyModeProps | BYOKMultiKeyModeProps)

interface EditingState {
  providerId: string
  /** Set when updating an existing key in multi-key mode. */
  keyId?: string
}

interface DeleteConfirmState {
  providerId: string
  /** Set when deleting a single key in multi-key mode. */
  keyId?: string
}

const NO_KEYS: BYOKManagerKey[] = []
const DEFAULT_CAPABILITIES: BYOKManagerCapabilities = {
  add: true,
  update: true,
  delete: true,
}

/**
 * Shared BYOK key list + add/update/delete modals. Used by both the workspace
 * BYOK settings page (multi-key mode, with per-provider round-robin pools)
 * and the enterprise mothership BYOK tab (single-key mode) so the two stay
 * visually identical; only the provider set and the backing store differ.
 *
 * Renders content only (search, provider sections, modals) — the caller owns
 * the page chrome (background, scroll container, and `max-w` centering).
 */
export function BYOKKeyManager(props: BYOKKeyManagerProps) {
  const {
    providers,
    isLoading,
    isSaving = false,
    isDeleting = false,
    capabilities = DEFAULT_CAPABILITIES,
    sections,
    description,
    scopeLabel = 'this workspace',
    keyUsageDescription,
    lastKeyDeleteMessage = 'This workspace will revert to using platform hosted keys.',
    showSearch = true,
  } = props

  const [localSearchTerm, setLocalSearchTerm] = useState('')
  const searchTerm = props.searchTerm ?? localSearchTerm
  const setSearchTerm = props.onSearchTermChange ?? setLocalSearchTerm
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)
  const [managingProviderId, setManagingProviderId] = useState<string | null>(null)

  const filteredProviders = useMemo(() => {
    if (!searchTerm.trim()) return providers
    const searchLower = searchTerm.toLowerCase()
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.description.toLowerCase().includes(searchLower)
    )
  }, [searchTerm, providers])

  const filteredIds = useMemo(
    () => new Set(filteredProviders.map((p) => p.id)),
    [filteredProviders]
  )

  const getProviderKeys = (providerId: string): BYOKManagerKey[] =>
    props.multiKey ? (props.keysByProvider.get(providerId) ?? NO_KEYS) : NO_KEYS

  const hasStoredKey = (providerId: string): boolean =>
    props.multiKey
      ? getProviderKeys(providerId).length > 0
      : props.configuredProviderIds.has(providerId)

  const showNoResults = searchTerm.trim() !== '' && filteredProviders.length === 0
  const editingMeta = providers.find((p) => p.id === editing?.providerId)
  const deleteMeta = providers.find((p) => p.id === deleteConfirm?.providerId)
  const managingMeta = providers.find((p) => p.id === managingProviderId) ?? null
  const isUpdatingExistingKey = props.multiKey
    ? !!editing?.keyId
    : !!editing && hasStoredKey(editing.providerId)
  const canSaveEditingKey = isUpdatingExistingKey ? capabilities.update : capabilities.add
  const isDeletingLastKey =
    !!deleteConfirm &&
    (!props.multiKey ||
      !deleteConfirm.keyId ||
      getProviderKeys(deleteConfirm.providerId).length === 1)
  const canManageKeys = capabilities.add || capabilities.update || capabilities.delete

  const openEditModal = (providerId: string, key?: BYOKManagerKey) => {
    const isUpdating = key !== undefined || (!props.multiKey && hasStoredKey(providerId))
    if (isUpdating ? !capabilities.update : !capabilities.add) return

    setManagingProviderId(null)
    setEditing({ providerId, keyId: key?.id })
    setApiKeyInput('')
    setNameInput(key?.name ?? '')
    setShowApiKey(false)
    setError(null)
  }

  const closeEditModal = () => {
    setEditing(null)
    setApiKeyInput('')
    setNameInput('')
    setShowApiKey(false)
    setError(null)
  }

  const openDeleteConfirm = (providerId: string, keyId?: string) => {
    if (!capabilities.delete) return

    setManagingProviderId(null)
    setDeleteConfirm({ providerId, keyId })
  }

  const handleSave = async () => {
    if (!editing || !apiKeyInput.trim() || isSaving || !canSaveEditingKey) {
      return
    }

    setError(null)
    try {
      if (props.multiKey) {
        await props.onSaveKey({
          providerId: editing.providerId,
          apiKey: apiKeyInput.trim(),
          keyId: editing.keyId,
          name: nameInput.trim(),
        })
      } else {
        await props.onSave(editing.providerId, apiKeyInput.trim())
      }
      closeEditModal()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save API key'))
      logger.error('Failed to save BYOK key', { error: err })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm || !capabilities.delete) return

    try {
      if (props.multiKey) {
        const { providerId, keyId } = deleteConfirm
        if (!keyId) {
          logger.error('Delete confirmation is missing a keyId in multi-key mode', { providerId })
          setDeleteConfirm(null)
          return
        }
        await props.onDeleteKey(providerId, keyId)
      } else {
        await props.onDelete(deleteConfirm.providerId)
      }
      setDeleteConfirm(null)
    } catch (err) {
      logger.error('Failed to delete BYOK key', { error: err })
    }
  }

  const renderActions = (provider: BYOKManagerProvider) => {
    if (!hasStoredKey(provider.id)) {
      if (!capabilities.add) return null
      return (
        <Chip variant='primary' onClick={() => openEditModal(provider.id)}>
          Add Key
        </Chip>
      )
    }

    if (props.multiKey) {
      const keyCount = getProviderKeys(provider.id).length
      return (
        <div className='flex items-center gap-2'>
          <span className='text-[var(--text-muted)] text-caption'>
            {keyCount} {keyCount === 1 ? 'key' : 'keys'}
          </span>
          <Chip onClick={() => setManagingProviderId(provider.id)}>
            {canManageKeys ? 'Manage' : 'View'}
          </Chip>
        </div>
      )
    }

    if (!capabilities.update && !capabilities.delete) return null
    return (
      <div className='flex items-center gap-2'>
        {capabilities.update && <Chip onClick={() => openEditModal(provider.id)}>Update</Chip>}
        {capabilities.delete && <Chip onClick={() => openDeleteConfirm(provider.id)}>Delete</Chip>}
      </div>
    )
  }

  const renderRow = (provider: BYOKManagerProvider) => {
    const Icon = provider.icon

    return (
      <SettingsResourceRow
        key={provider.id}
        icon={<Icon />}
        title={provider.name}
        description={provider.description}
        badge={provider.badge}
        trailing={renderActions(provider)}
      />
    )
  }

  return (
    <>
      <div className='flex flex-col gap-4.5'>
        {showSearch && (
          <ChipInput
            icon={Search}
            aria-label='Search providers'
            placeholder='Search providers...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={isLoading}
            className='w-full'
          />
        )}

        {description && <p className='text-[var(--text-secondary)] text-sm'>{description}</p>}

        {isLoading ? null : showNoResults ? (
          <SettingsEmptyState variant='inline'>
            No providers found matching "{searchTerm}"
          </SettingsEmptyState>
        ) : sections ? (
          <div className='flex flex-col gap-7'>
            {sections.map((section) => {
              const rows = providers.filter(
                (p) => section.ids.includes(p.id) && filteredIds.has(p.id)
              )
              if (rows.length === 0) return null

              return (
                <SettingsSection key={section.label} label={section.label}>
                  <div className={RESOURCE_LIST_STACK}>{rows.map(renderRow)}</div>
                </SettingsSection>
              )
            })}
          </div>
        ) : (
          <div className={RESOURCE_LIST_STACK}>{filteredProviders.map(renderRow)}</div>
        )}
      </div>

      {props.multiKey && (
        <BYOKProviderKeysModal
          open={!!managingProviderId}
          onOpenChange={(open) => {
            if (!open) setManagingProviderId(null)
          }}
          provider={managingMeta}
          keys={managingProviderId ? getProviderKeys(managingProviderId) : NO_KEYS}
          maxKeys={props.maxKeysPerProvider}
          capabilities={capabilities}
          onAddKey={() => managingProviderId && openEditModal(managingProviderId)}
          onUpdateKey={(key) => managingProviderId && openEditModal(managingProviderId, key)}
          onDeleteKey={(key) => managingProviderId && openDeleteConfirm(managingProviderId, key.id)}
        />
      )}

      <ChipModal
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) closeEditModal()
        }}
        srTitle='Add/Update API Key'
      >
        <ChipModalHeader onClose={closeEditModal}>
          {editingMeta && (
            <>
              {isUpdatingExistingKey ? 'Update' : 'Add'} {editingMeta.name} API Key
            </>
          )}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            {keyUsageDescription ??
              (props.multiKey
                ? `Requests are distributed evenly across all ${editingMeta?.name} keys in ${scopeLabel}. Your key is encrypted and stored securely.`
                : `This key will be used for all ${editingMeta?.name} requests in ${scopeLabel}. Your key is encrypted and stored securely.`)}
          </p>
          <ChipModalField type='custom' title='API Key' required>
            <input
              type='text'
              name='fakeusernameremembered'
              autoComplete='username'
              aria-hidden='true'
              style={{
                position: 'absolute',
                left: '-9999px',
                opacity: 0,
                pointerEvents: 'none',
              }}
              tabIndex={-1}
              readOnly
            />
            <div className={CHIP_FIELD_SHELL}>
              <input
                aria-label='API Key'
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={editingMeta?.placeholder}
                className={CHIP_FIELD_INPUT}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
                name='byok_api_key'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
              <Button
                variant='quiet'
                size='icon'
                className='shrink-0'
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff className='size-[13px]' /> : <Eye className='size-[13px]' />}
              </Button>
            </div>
          </ChipModalField>
          {props.multiKey && (
            <ChipModalField
              type='input'
              title='Name'
              value={nameInput}
              onChange={setNameInput}
              placeholder='e.g. Production key'
              maxLength={120}
              onSubmit={handleSave}
            />
          )}
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={closeEditModal}
          cancelDisabled={isSaving}
          primaryAction={{
            label: isSaving ? 'Saving...' : 'Save',
            onClick: handleSave,
            disabled: !apiKeyInput.trim() || isSaving || !canSaveEditingKey,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null)
        }}
        srTitle='Delete API Key'
        title='Delete API Key'
        text={[
          'Are you sure you want to delete the ',
          { text: deleteMeta?.name ?? 'selected', bold: true },
          ' API key? ',
          isDeletingLastKey
            ? { text: lastKeyDeleteMessage, error: true }
            : `Requests will continue using the remaining ${deleteMeta?.name ?? 'provider'} keys.`,
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          disabled: !capabilities.delete,
          pending: isDeleting,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
