'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { formatDate } from '@sim/utils/formatting'
import { Plus } from 'lucide-react'
import {
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretReveal,
} from '@/components/emcn'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  type CopilotKey,
  useCopilotKeys,
  useDeleteCopilotKey,
  useGenerateCopilotKey,
} from '@/hooks/queries/copilot-keys'

const logger = createLogger('CopilotSettings')

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
        `A Chat API key named "${trimmedName}" already exists. Please choose a different name.`
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
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search API keys...',
        }}
        actions={
          <Chip
            leftIcon={Plus}
            variant='primary'
            onClick={() => {
              setIsCreateDialogOpen(true)
              setCreateError(null)
            }}
            disabled={isLoading}
          >
            Create API Key
          </Chip>
        }
      >
        {isLoading ? null : showEmptyState ? (
          <SettingsEmptyState>Click "Create API Key" above to get started</SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-2'>
            {filteredKeys.map((key) => (
              <div key={key.id} className='flex items-center justify-between gap-3'>
                <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                  <div className='flex items-center gap-1.5'>
                    <span className='max-w-[280px] truncate text-[14px] text-[var(--text-body)]'>
                      {key.name || 'Unnamed Key'}
                    </span>
                    <span className='text-[var(--text-secondary)] text-sm'>
                      (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                    </span>
                  </div>
                  <p className='truncate text-[12px] text-[var(--text-muted)]'>{key.displayKey}</p>
                </div>
                <Chip
                  className='flex-shrink-0'
                  onClick={() => {
                    setDeleteKey(key)
                    setShowDeleteDialog(true)
                  }}
                >
                  Delete
                </Chip>
              </div>
            ))}
            {showNoResults && (
              <SettingsEmptyState variant='inline'>
                No API keys found matching "{searchTerm}"
              </SettingsEmptyState>
            )}
          </div>
        )}
      </SettingsPanel>

      <ChipModal
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        srTitle='Create new API key'
      >
        <ChipModalHeader onClose={() => setIsCreateDialogOpen(false)}>
          Create new API key
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            This key will allow access to Chat features. Make sure to copy it after creation as you
            won't be able to see it again.
          </p>
          <ChipModalField
            type='input'
            title='Key name'
            value={newKeyName}
            onChange={(value) => {
              setNewKeyName(value)
              if (createError) setCreateError(null)
            }}
            placeholder='e.g., Development, Production'
            required
          />
          <ChipModalError>{createError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {
            setIsCreateDialogOpen(false)
            setNewKeyName('')
            setCreateError(null)
          }}
          primaryAction={{
            label: generateKey.isPending ? 'Creating...' : 'Create',
            onClick: handleCreateKey,
            disabled: !newKeyName.trim() || generateKey.isPending,
          }}
        />
      </ChipModal>

      <ChipModal
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
          }
        }}
        srTitle='Your API key has been created'
      >
        <ChipModalHeader
          onClose={() => {
            setShowNewKeyDialog(false)
            setNewKey(null)
          }}
        >
          Your API key has been created
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='custom' title="Copy it now — it won't be shown again">
            {newKey && <SecretReveal value={newKey} />}
          </ChipModalField>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => {
            setShowNewKeyDialog(false)
            setNewKey(null)
          }}
          primaryAction={{
            label: 'Done',
            onClick: () => {
              setShowNewKeyDialog(false)
              setNewKey(null)
            },
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowDeleteDialog(false)
            setDeleteKey(null)
          }
        }}
        srTitle='Delete API key'
        title='Delete API key'
        text={[
          'Deleting ',
          { text: deleteKey?.name || 'Unnamed Key', bold: true },
          ' ',
          { text: 'will immediately revoke access for any integrations using it.', error: true },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDeleteKey,
          pending: deleteKeyMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
