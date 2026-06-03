'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Eye, EyeOff, Search } from 'lucide-react'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { BYOKKeySkeleton } from '@/app/workspace/[workspaceId]/settings/components/byok/byok-skeleton'

const logger = createLogger('BYOKKeyManager')

export interface BYOKManagerProvider {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  placeholder: string
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
  /** Subtitle shown above the provider list. */
  description?: string
  /** Show the provider search box (hidden when there are only a couple). */
  showSearch?: boolean
}

/**
 * Shared BYOK key list + add/update/delete modals. Used by both the workspace
 * BYOK settings page and the enterprise mothership BYOK tab so the two stay
 * visually identical; only the provider set and the backing store differ.
 */
export function BYOKKeyManager({
  providers,
  configuredProviderIds,
  isLoading,
  onSave,
  onDelete,
  isSaving = false,
  isDeleting = false,
  description = 'Use your own API keys for hosted model providers.',
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

  const showNoResults = searchTerm.trim() && filteredProviders.length === 0
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

  return (
    <>
      <div className='flex h-full flex-col gap-4.5'>
        {showSearch && (
          <div className='flex items-center gap-2'>
            <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
              <Search
                className='size-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
                strokeWidth={2}
              />
              <Input
                placeholder='Search providers...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={isLoading}
                className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
          </div>
        )}

        <p className='text-[var(--text-secondary)] text-sm'>{description}</p>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-2'>
              {providers.map((p) => (
                <BYOKKeySkeleton key={p.id} />
              ))}
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {filteredProviders.map((provider) => {
                const hasKey = configuredProviderIds.has(provider.id)
                const Icon = provider.icon

                return (
                  <div key={provider.id} className='flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-3'>
                      <div className='flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-6)]'>
                        <Icon className='size-4' />
                      </div>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <span className='font-medium text-base'>{provider.name}</span>
                        <p className='truncate text-[var(--text-muted)] text-sm'>
                          {provider.description}
                        </p>
                      </div>
                    </div>

                    {hasKey ? (
                      <div className='flex flex-shrink-0 items-center gap-2'>
                        <Button variant='default' onClick={() => openEditModal(provider.id)}>
                          Update
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() => setDeleteConfirmProvider(provider.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <Button variant='primary' onClick={() => openEditModal(provider.id)}>
                        Add Key
                      </Button>
                    )}
                  </div>
                )
              })}
              {showNoResults && (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No providers found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!editingProvider}
        onOpenChange={(open) => {
          if (!open) closeEditModal()
        }}
      >
        <ModalContent size='md'>
          <ModalHeader>
            {editingMeta && (
              <>
                {configuredProviderIds.has(editingMeta.id) ? 'Update' : 'Add'} {editingMeta.name}{' '}
                API Key
              </>
            )}
          </ModalHeader>
          <ModalBody>
            <ModalDescription className='text-[var(--text-secondary)]'>
              This key will be used for all {editingMeta?.name} requests in this workspace. Your key
              is encrypted and stored securely.
            </ModalDescription>

            <div className='mt-4 flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Enter your API key</p>
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
              <div className='relative'>
                <EmcnInput
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={editingMeta?.placeholder}
                  className='h-9 pr-9'
                  name='byok_api_key'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
                <Button
                  variant='ghost'
                  className='-translate-y-1/2 absolute top-1/2 right-[4px] size-[28px] p-0'
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className='size-[14px]' />
                  ) : (
                    <Eye className='size-[14px]' />
                  )}
                </Button>
              </div>
              {error && (
                <p className='text-[var(--text-error)] text-small leading-tight'>{error}</p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant='default' onClick={closeEditModal}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleSave}
              disabled={!apiKeyInput.trim() || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={!!deleteConfirmProvider} onOpenChange={() => setDeleteConfirmProvider(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete API Key</ModalHeader>
          <ModalBody>
            <ModalDescription className='text-[var(--text-secondary)]'>
              Are you sure you want to delete the{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deleteMeta?.name}</span> API
              key?{' '}
              <span className='text-[var(--text-error)]'>
                This workspace will revert to using platform hosted keys.
              </span>{' '}
              This action cannot be undone.
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeleteConfirmProvider(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
