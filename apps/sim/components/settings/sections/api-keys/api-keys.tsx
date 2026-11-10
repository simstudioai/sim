'use client'

import { useMemo, useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn-legacy'
import { Plus } from '@sim/emcn-legacy/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { RowActionsMenu } from '@/components/settings/primitives/row-actions-menu'
import { SettingsEmptyState } from '@/components/settings/primitives/settings-empty-state'
import type { SettingsAction } from '@/components/settings/primitives/settings-header/settings-header'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/components/settings/primitives/settings-resource-row'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import { CreateApiKeyModal } from '@/components/settings/sections/api-keys/components'
import type { ApiKey } from '@/lib/api/contracts/api-keys'
import { useApiKeys, useDeleteApiKey } from '@/hooks/queries/api-keys'
import { useSettingsSearch } from '@/hooks/use-settings-search'

const logger = createLogger('ApiKeys')

/** Stable empty references so memoized derivations don't re-run while data loads. */
const EMPTY_KEYS: ApiKey[] = []

/** Copies an API key's name and confirms with a toast. */
function copyKeyName(name: string) {
  void navigator.clipboard.writeText(name)
  toast.success('Copied name to clipboard')
}

/** Formats an API key's last-used timestamp, or "Never" when unused. */
function formatLastUsed(dateString?: string | null): string {
  if (!dateString) return 'Never'
  return formatDate(new Date(dateString))
}

interface ApiKeyRowMenuProps {
  keyName: string
  onDelete: () => void
}

/**
 * Trailing `...` actions menu for an API key row. Mirrors the Secrets /
 * Teammates row menu so the settings experience is consistent.
 */
function ApiKeyRowMenu({ keyName, onDelete }: ApiKeyRowMenuProps) {
  return (
    <div className='shrink-0'>
      <RowActionsMenu
        label='API key actions'
        actions={[
          { label: 'Copy name', onSelect: () => copyKeyName(keyName) },
          { label: 'Delete', destructive: true, onSelect: onDelete },
        ]}
      />
    </div>
  )
}

/** The signed-in user's personal Sim API keys, on the account settings plane. */
export function ApiKeys() {
  const {
    data: apiKeysData,
    isLoading,
    error: apiKeysError,
    refetch: refetchApiKeys,
  } = useApiKeys('', 'personal')
  const deleteApiKeyMutation = useDeleteApiKey()

  const personalKeys = apiKeysData?.personalKeys ?? EMPTY_KEYS

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useSettingsSearch()

  const createButtonDisabled = isLoading || (Boolean(apiKeysError) && apiKeysData === undefined)

  const filteredPersonalKeys = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (term === '') return personalKeys
    return personalKeys.filter((key) => key.name.toLowerCase().includes(term))
  }, [personalKeys, searchTerm])

  const handleDeleteKey = async () => {
    if (!deleteKey) return

    try {
      setShowDeleteDialog(false)
      setDeleteKey(null)
      await deleteApiKeyMutation.mutateAsync({
        workspaceId: '',
        keyId: deleteKey.id,
        keyType: 'personal',
      })
    } catch (error) {
      logger.error('Error deleting API key:', { error })
      refetchApiKeys()
    }
  }

  const actions: SettingsAction[] = [
    {
      text: 'Create API key',
      icon: Plus,
      variant: 'primary',
      onSelect: () => {
        if (createButtonDisabled) return
        setIsCreateDialogOpen(true)
      },
      disabled: createButtonDisabled,
    },
  ]

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search API keys...',
        }}
        actions={actions}
      >
        {apiKeysError && apiKeysData === undefined ? (
          <SettingsEmptyState>
            {getErrorMessage(apiKeysError, 'Failed to load API keys')}
          </SettingsEmptyState>
        ) : isLoading ? null : personalKeys.length === 0 ? (
          <SettingsEmptyState>Click "Create API key" above to get started</SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-6'>
            {filteredPersonalKeys.length > 0 && (
              <SettingsSection label='Personal'>
                <div className={RESOURCE_LIST_STACK}>
                  {filteredPersonalKeys.map((key) => (
                    <SettingsResourceRow
                      key={key.id}
                      title={key.name}
                      description={key.displayKey}
                      badge={
                        <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
                          {`last used ${formatLastUsed(key.lastUsed).toLowerCase()}`}
                        </span>
                      }
                      trailing={
                        <ApiKeyRowMenu
                          keyName={key.name}
                          onDelete={() => {
                            setDeleteKey(key)
                            setShowDeleteDialog(true)
                          }}
                        />
                      }
                    />
                  ))}
                </div>
              </SettingsSection>
            )}

            {searchTerm.trim() && filteredPersonalKeys.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No API keys found matching "{searchTerm}"
              </SettingsEmptyState>
            )}
          </div>
        )}
      </SettingsPanel>

      <CreateApiKeyModal
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        existingKeyNames={personalKeys.map((k) => k.name)}
      />

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
          { text: deleteKey?.name ?? 'this key', bold: true },
          ' ',
          { text: 'will immediately revoke access for any integrations using it.', error: true },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDeleteKey,
          pending: deleteApiKeyMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
