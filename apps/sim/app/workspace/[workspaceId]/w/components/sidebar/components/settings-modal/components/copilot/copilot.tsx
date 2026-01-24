'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Copy, Plus, Search } from 'lucide-react'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { formatDate } from '@/lib/core/utils/formatting'
import {
  type CopilotKey,
  useCopilotKeys,
  useDeleteCopilotKey,
  useGenerateCopilotKey,
} from '@/hooks/queries/copilot-keys'

const logger = createLogger('CopilotSettings')

/**
 * Skeleton component for loading state of copilot key items
 */
function CopilotKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <Skeleton className='h-5 w-[80px]' />
          <Skeleton className='h-5 w-[140px]' />
        </div>
        <Skeleton className='h-5 w-[100px]' />
      </div>
      <Skeleton className='h-[26px] w-[48px] rounded-[6px]' />
    </div>
  )
}

/**
 * Copilot Keys management component for handling API keys used with the Copilot feature.
 * Provides functionality to create, view, and delete copilot API keys.
 */
export function Copilot() {
  const { data: keys = [], isLoading } = useCopilotKeys()
  const generateKey = useGenerateCopilotKey()
  const deleteKeyMutation = useDeleteCopilotKey()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const filteredKeys = useMemo(() => {
    if (!searchTerm.trim()) return keys
    const term = searchTerm.toLowerCase()
    return keys.filter(
      (key) =>
        key.name?.toLowerCase().includes(term) || key.displayKey?.toLowerCase().includes(term)
    )
  }, [keys, searchTerm])

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = keys.some((k) => k.name === trimmedName)
    if (isDuplicate) {
      setCreateError(
        `A Copilot API key named "${trimmedName}" already exists. Please choose a different name.`
      )
      return
    }

    setCreateError(null)
    try {
      const data = await generateKey.mutateAsync({ name: trimmedName })
      if (data?.key?.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
        setNewKeyName('')
        setCreateError(null)
        setIsCreateDialogOpen(false)
      }
    } catch (error) {
      logger.error('Failed to generate copilot API key', { error })
      setCreateError('Failed to create API key. Please check your connection and try again.')
    }
  }

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleDeleteKey = async () => {
    if (!deleteKey) return
    try {
      setShowDeleteDialog(false)
      const keyToDelete = deleteKey
      setDeleteKey(null)

      await deleteKeyMutation.mutateAsync({ keyId: keyToDelete.id })
    } catch (error) {
      logger.error('Failed to delete copilot API key', { error })
    }
  }

  const formatLastUsed = (dateString?: string | null) => {
    if (!dateString) return 'Never'
    return formatDate(new Date(dateString))
  }

  const hasKeys = keys.length > 0
  const showEmptyState = !hasKeys
  const showNoResults = searchTerm.trim() && filteredKeys.length === 0 && keys.length > 0

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        {/* Search Input and Create Button */}
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search API keys...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button
            onClick={() => {
              setIsCreateDialogOpen(true)
              setCreateError(null)
            }}
            variant='tertiary'
            disabled={isLoading}
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Create
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
              Click "Create" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {filteredKeys.map((key) => (
                <div key={key.id} className='flex items-center justify-between gap-[12px]'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <div className='flex items-center gap-[6px]'>
                      <span className='max-w-[280px] truncate font-medium text-[14px]'>
                        {key.name || 'Unnamed Key'}
                      </span>
                      <span className='text-[13px] text-[var(--text-secondary)]'>
                        (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                      </span>
                    </div>
                    <p className='truncate text-[13px] text-[var(--text-muted)]'>
                      {key.displayKey}
                    </p>
                  </div>
                  <Button
                    variant='ghost'
                    className='flex-shrink-0'
                    onClick={() => {
                      setDeleteKey(key)
                      setShowDeleteDialog(true)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ))}
              {showNoResults && (
                <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                  No API keys found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <Modal open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Create new API key</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              This key will allow access to Copilot features. Make sure to copy it after creation as
              you won't be able to see it again.
            </p>

            <div className='mt-[16px] flex flex-col gap-[8px]'>
              <p className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Enter a name for your API key to help you identify it later.
              </p>
              <EmcnInput
                value={newKeyName}
                onChange={(e) => {
                  setNewKeyName(e.target.value)
                  if (createError) setCreateError(null)
                }}
                placeholder='e.g., Development, Production'
                className='h-9'
                autoFocus
              />
              {createError && (
                <p className='text-[12px] text-[var(--text-error)] leading-tight'>{createError}</p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setIsCreateDialogOpen(false)
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='tertiary'
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || generateKey.isPending}
            >
              {generateKey.isPending ? 'Creating...' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* New API Key Dialog */}
      <Modal
        open={showNewKeyDialog}
        onOpenChange={(open: boolean) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setCopySuccess(false)
          }
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>Your API key has been created</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              This is the only time you will see your API key.{' '}
              <span className='font-semibold text-[var(--text-primary)]'>
                Copy it now and store it securely.
              </span>
            </p>

            {newKey && (
              <div className='relative mt-[10px]'>
                <div className='flex h-9 items-center rounded-[6px] border bg-[var(--surface-1)] px-[10px] pr-[40px]'>
                  <code className='flex-1 truncate font-mono text-[13px] text-[var(--text-primary)]'>
                    {newKey}
                  </code>
                </div>
                <Button
                  variant='ghost'
                  className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] rounded-[4px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  onClick={() => copyToClipboard(newKey)}
                >
                  {copySuccess ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Copy className='h-[14px] w-[14px]' />
                  )}
                  <span className='sr-only'>Copy to clipboard</span>
                </Button>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete API key</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Deleting{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {deleteKey?.name || 'Unnamed Key'}
              </span>{' '}
              will immediately revoke access for any integrations using it.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              disabled={deleteKeyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteKey}
              disabled={deleteKeyMutation.isPending}
            >
              {deleteKeyMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
