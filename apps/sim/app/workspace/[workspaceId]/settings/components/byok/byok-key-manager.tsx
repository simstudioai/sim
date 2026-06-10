'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Eye, EyeOff, Search } from 'lucide-react'
import {
  Button,
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  CHIP_FIELD_INPUT,
  CHIP_FIELD_SHELL,
} from '@/app/workspace/[workspaceId]/components/credential-detail/components/chip-field'
import { BYOKKeySkeleton } from '@/app/workspace/[workspaceId]/settings/components/byok/byok-skeleton'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

const logger = createLogger('BYOKKeyManager')

export interface BYOKManagerProvider {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  placeholder: string
}

/**
 * Optional provider grouping. Each provider id should belong to exactly one
 * section; rows keep their {@link BYOKKeyManagerProps.providers} order within a
 * group. When omitted, providers render as a single flat list.
 */
export interface BYOKProviderSection {
  label: string
  ids: string[]
}

interface BYOKKeyManagerProps {
  /** Providers to render, in display order. */
  providers: BYOKManagerProvider[]
  /** Provider ids that currently have a stored key. */
  configuredProviderIds: Set<string>
  isLoading: boolean
  /** Persist a key. Throw to surface an error in the modal. */
  onSave: (providerId: string, apiKey: string) => Promise<void>
  /** Remove a key. */
  onDelete: (providerId: string) => Promise<void>
  isSaving?: boolean
  isDeleting?: boolean
  /** Labeled provider groups. When omitted, renders a single flat list. */
  sections?: BYOKProviderSection[]
  /** Optional subtitle shown above the provider list. */
  description?: string
  /** Show the provider search box (hidden when there are only a couple). */
  showSearch?: boolean
}

/**
 * Shared BYOK key list + add/update/delete modals. Used by both the workspace
 * BYOK settings page and the enterprise mothership BYOK tab so the two stay
 * visually identical; only the provider set and the backing store differ.
 *
 * Renders content only (search, provider sections, modals) — the caller owns
 * the page chrome (background, scroll container, and `max-w` centering).
 */
export function BYOKKeyManager({
  providers,
  configuredProviderIds,
  isLoading,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
  sections,
  description,
  showSearch = true,
}: BYOKKeyManagerProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [editingProvider, setEditingProvider] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<string | null>(null)

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

  const showNoResults = searchTerm.trim() !== '' && filteredProviders.length === 0
  const editingMeta = providers.find((p) => p.id === editingProvider)
  const deleteMeta = providers.find((p) => p.id === deleteConfirmProvider)

  const openEditModal = (providerId: string) => {
    setEditingProvider(providerId)
    setApiKeyInput('')
    setShowApiKey(false)
    setError(null)
  }

  const closeEditModal = () => {
    setEditingProvider(null)
    setApiKeyInput('')
    setShowApiKey(false)
    setError(null)
  }

  const handleSave = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return

    setError(null)
    try {
      await onSave(editingProvider, apiKeyInput.trim())
      closeEditModal()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to save API key'))
      logger.error('Failed to save BYOK key', { error: err })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirmProvider) return

    try {
      await onDelete(deleteConfirmProvider)
      setDeleteConfirmProvider(null)
    } catch (err) {
      logger.error('Failed to delete BYOK key', { error: err })
    }
  }

  const renderRow = (provider: BYOKManagerProvider) => {
    const hasKey = configuredProviderIds.has(provider.id)
    const Icon = provider.icon

    return (
      <div key={provider.id} className='flex items-center justify-between gap-2.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
            <Icon className='size-5' />
          </div>
          <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
            <span className='truncate text-[14px] text-[var(--text-body)]'>{provider.name}</span>
            <span className='truncate text-[12px] text-[var(--text-muted)]'>
              {provider.description}
            </span>
          </div>
        </div>

        {hasKey ? (
          <div className='flex flex-shrink-0 items-center gap-2'>
            <Chip onClick={() => openEditModal(provider.id)}>Update</Chip>
            <Chip onClick={() => setDeleteConfirmProvider(provider.id)}>Delete</Chip>
          </div>
        ) : (
          <Chip variant='primary' onClick={() => openEditModal(provider.id)}>
            Add Key
          </Chip>
        )}
      </div>
    )
  }

  return (
    <>
      <div className='flex flex-col gap-4.5'>
        {showSearch && (
          <div className={CHIP_FIELD_SHELL}>
            <Search
              className='size-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <input
              placeholder='Search providers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className={cn(CHIP_FIELD_INPUT, 'disabled:cursor-not-allowed disabled:opacity-60')}
            />
          </div>
        )}

        {description && <p className='text-[var(--text-secondary)] text-sm'>{description}</p>}

        {isLoading ? (
          <div className='flex flex-col gap-2'>
            {providers.map((p) => (
              <BYOKKeySkeleton key={p.id} />
            ))}
          </div>
        ) : showNoResults ? (
          <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
            No providers found matching "{searchTerm}"
          </div>
        ) : sections ? (
          <div className='flex flex-col gap-7'>
            {sections.map((section) => {
              const rows = providers.filter(
                (p) => section.ids.includes(p.id) && filteredIds.has(p.id)
              )
              if (rows.length === 0) return null

              return (
                <SettingsSection key={section.label} label={section.label}>
                  <div className='flex flex-col gap-2'>{rows.map(renderRow)}</div>
                </SettingsSection>
              )
            })}
          </div>
        ) : (
          <div className='flex flex-col gap-2'>{filteredProviders.map(renderRow)}</div>
        )}
      </div>

      <ChipModal
        open={!!editingProvider}
        onOpenChange={(open) => {
          if (!open) closeEditModal()
        }}
        srTitle='Add/Update API Key'
      >
        <ChipModalHeader onClose={closeEditModal}>
          {editingMeta && (
            <>
              {configuredProviderIds.has(editingMeta.id) ? 'Update' : 'Add'} {editingMeta.name} API
              Key
            </>
          )}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            This key will be used for all {editingMeta?.name} requests in this workspace. Your key
            is encrypted and stored securely.
          </p>
          <ChipModalField type='custom' title='API Key' required>
            {/* Hidden decoy fields to prevent browser autofill */}
            <input
              type='text'
              name='fakeusernameremembered'
              autoComplete='username'
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
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value)
                  if (error) setError(null)
                }}
                placeholder={editingMeta?.placeholder}
                className={CHIP_FIELD_INPUT}
                name='byok_api_key'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
              <Button
                variant='quiet'
                className='size-[18px] shrink-0 rounded-sm p-0'
                onClick={() => setShowApiKey(!showApiKey)}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? <EyeOff className='size-[13px]' /> : <Eye className='size-[13px]' />}
              </Button>
            </div>
          </ChipModalField>
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={closeEditModal}
          cancelDisabled={isSaving}
          primaryAction={{
            label: isSaving ? 'Saving...' : 'Save',
            onClick: handleSave,
            disabled: !apiKeyInput.trim() || isSaving,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={!!deleteConfirmProvider}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmProvider(null)
        }}
        srTitle='Delete API Key'
        title='Delete API Key'
        description={
          <>
            Are you sure you want to delete the{' '}
            <span className='font-medium text-[var(--text-primary)]'>{deleteMeta?.name}</span> API
            key?{' '}
            <span className='text-[var(--text-error)]'>
              This workspace will revert to using platform hosted keys.
            </span>{' '}
            This action cannot be undone.
          </>
        }
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: isDeleting,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
