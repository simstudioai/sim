'use client'

import { useMemo, useState } from 'react'
import { ChipConfirmModal, Switch, Tooltip, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { formatDate } from '@sim/utils/formatting'
import { Info, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  type ApiKey,
  useApiKeys,
  useDeleteApiKey,
  useUpdateWorkspaceApiKeySettings,
} from '@/hooks/queries/api-keys'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { CreateApiKeyModal } from './components'

const logger = createLogger('ApiKeys')

/** Stable empty references so memoized derivations don't re-run while data loads. */
const EMPTY_KEYS: ApiKey[] = []
const EMPTY_KEY_NAMES: string[] = []

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
  /** When false, the Delete item is disabled (e.g. non-admins on workspace keys). */
  canDelete?: boolean
}

/**
 * Trailing `...` actions menu for an API key row. Mirrors the Secrets /
 * Teammates row menu so the settings experience is consistent.
 */
function ApiKeyRowMenu({ keyName, onDelete, canDelete = true }: ApiKeyRowMenuProps) {
  return (
    <div className='flex-shrink-0'>
      <RowActionsMenu
        label='API key actions'
        actions={[
          { label: 'Copy name', onSelect: () => copyKeyName(keyName) },
          { label: 'Delete', destructive: true, disabled: !canDelete, onSelect: onDelete },
        ]}
      />
    </div>
  )
}

export function ApiKeys() {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin

  const {
    data: apiKeysData,
    isLoading: isLoadingKeys,
    refetch: refetchApiKeys,
  } = useApiKeys(workspaceId)
  const { data: workspaceSettingsData, isLoading: isLoadingSettings } =
    useWorkspaceSettings(workspaceId)
  const deleteApiKeyMutation = useDeleteApiKey()
  const updateSettingsMutation = useUpdateWorkspaceApiKeySettings()

  const workspaceKeys = apiKeysData?.workspaceKeys ?? EMPTY_KEYS
  const personalKeys = apiKeysData?.personalKeys ?? EMPTY_KEYS
  const conflicts = apiKeysData?.conflicts ?? EMPTY_KEY_NAMES
  const isLoading = isLoadingKeys || isLoadingSettings

  const allowPersonalApiKeys =
    workspaceSettingsData?.settings?.workspace?.allowPersonalApiKeys ?? true

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const defaultKeyType = allowPersonalApiKeys ? 'personal' : 'workspace'
  const createButtonDisabled = isLoading || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

  const filteredWorkspaceKeys = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const result: { key: ApiKey; originalIndex: number }[] = []
    for (let index = 0; index < workspaceKeys.length; index++) {
      const key = workspaceKeys[index]
      if (term === '' || key.name.toLowerCase().includes(term)) {
        result.push({ key, originalIndex: index })
      }
    }
    return result
  }, [workspaceKeys, searchTerm])

  const filteredPersonalKeys = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const result: { key: ApiKey; originalIndex: number }[] = []
    for (let index = 0; index < personalKeys.length; index++) {
      const key = personalKeys[index]
      if (term === '' || key.name.toLowerCase().includes(term)) {
        result.push({ key, originalIndex: index })
      }
    }
    return result
  }, [personalKeys, searchTerm])

  const handleDeleteKey = async () => {
    if (!userId || !deleteKey) return

    try {
      const isWorkspaceKey = workspaceKeys.some((k) => k.id === deleteKey.id)
      const keyTypeToDelete = isWorkspaceKey ? 'workspace' : 'personal'

      setShowDeleteDialog(false)
      setDeleteKey(null)

      await deleteApiKeyMutation.mutateAsync({
        workspaceId,
        keyId: deleteKey.id,
        keyType: keyTypeToDelete,
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
        {isLoading ? null : personalKeys.length === 0 && workspaceKeys.length === 0 ? (
          <SettingsEmptyState>Click "Create API key" above to get started</SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-6'>
            {!searchTerm.trim() ? (
              <SettingsSection label='Workspace'>
                {workspaceKeys.length === 0 ? (
                  <div className='text-[var(--text-muted)] text-sm'>No workspace API keys yet</div>
                ) : (
                  <div className='flex flex-col gap-2'>
                    {workspaceKeys.map((key) => (
                      <div key={key.id} className='flex items-center justify-between gap-3'>
                        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                          <div className='flex items-center gap-1.5'>
                            <span className='max-w-[280px] truncate text-[14px] text-[var(--text-body)]'>
                              {key.name}
                            </span>
                            <span className='text-[var(--text-secondary)] text-sm'>
                              (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                            </span>
                          </div>
                          <p className='truncate text-[12px] text-[var(--text-muted)]'>
                            {key.displayKey || key.key}
                          </p>
                        </div>
                        <ApiKeyRowMenu
                          keyName={key.name}
                          onDelete={() => {
                            setDeleteKey(key)
                            setShowDeleteDialog(true)
                          }}
                          canDelete={canManageWorkspaceKeys}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </SettingsSection>
            ) : filteredWorkspaceKeys.length > 0 ? (
              <SettingsSection label='Workspace'>
                <div className='flex flex-col gap-2'>
                  {filteredWorkspaceKeys.map(({ key }) => (
                    <div key={key.id} className='flex items-center justify-between gap-3'>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <div className='flex items-center gap-1.5'>
                          <span className='max-w-[280px] truncate text-[14px] text-[var(--text-body)]'>
                            {key.name}
                          </span>
                          <span className='text-[var(--text-secondary)] text-sm'>
                            (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                          </span>
                        </div>
                        <p className='truncate text-[12px] text-[var(--text-muted)]'>
                          {key.displayKey || key.key}
                        </p>
                      </div>
                      <ApiKeyRowMenu
                        keyName={key.name}
                        onDelete={() => {
                          setDeleteKey(key)
                          setShowDeleteDialog(true)
                        }}
                        canDelete={canManageWorkspaceKeys}
                      />
                    </div>
                  ))}
                </div>
              </SettingsSection>
            ) : null}

            {(!searchTerm.trim() || filteredPersonalKeys.length > 0) && (
              <SettingsSection label='Personal'>
                <div className='flex flex-col gap-2'>
                  {filteredPersonalKeys.map(({ key }) => {
                    const isConflict = conflicts.includes(key.name)
                    return (
                      <div key={key.id} className='flex flex-col gap-2'>
                        <div className='flex items-center justify-between gap-3'>
                          <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                            <div className='flex items-center gap-1.5'>
                              <span className='max-w-[280px] truncate text-[14px] text-[var(--text-body)]'>
                                {key.name}
                              </span>
                              <span className='text-[var(--text-secondary)] text-sm'>
                                (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                              </span>
                            </div>
                            <p className='truncate text-[12px] text-[var(--text-muted)]'>
                              {key.displayKey || key.key}
                            </p>
                          </div>
                          <ApiKeyRowMenu
                            keyName={key.name}
                            onDelete={() => {
                              setDeleteKey(key)
                              setShowDeleteDialog(true)
                            }}
                          />
                        </div>
                        {isConflict && (
                          <div className='text-[var(--text-error)] text-small leading-tight'>
                            Workspace API key with the same name overrides this. Rename your
                            personal key to use it.
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </SettingsSection>
            )}

            {searchTerm.trim() &&
              filteredPersonalKeys.length === 0 &&
              filteredWorkspaceKeys.length === 0 &&
              (personalKeys.length > 0 || workspaceKeys.length > 0) && (
                <SettingsEmptyState variant='inline'>
                  No API keys found matching "{searchTerm}"
                </SettingsEmptyState>
              )}
          </div>
        )}

        {!isLoading && canManageWorkspaceKeys && (
          <Tooltip.Provider delayDuration={150}>
            <SettingsSection label='Permissions'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <span className='text-[14px] text-[var(--text-body)]'>
                    Allow personal API keys
                  </span>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type='button'
                        className='rounded-full p-1 text-[var(--text-muted)] transition hover-hover:text-[var(--text-primary)]'
                      >
                        <Info className='size-[12px]' strokeWidth={2} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top' className='max-w-xs text-small'>
                      Allow collaborators to create and use their own keys with billing charged to
                      them.
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
                {isLoadingSettings ? null : (
                  <Switch
                    checked={allowPersonalApiKeys}
                    disabled={!canManageWorkspaceKeys || updateSettingsMutation.isPending}
                    onCheckedChange={async (checked) => {
                      try {
                        await updateSettingsMutation.mutateAsync({
                          workspaceId,
                          allowPersonalApiKeys: checked,
                        })
                      } catch (error) {
                        logger.error('Error updating workspace settings:', { error })
                      }
                    }}
                  />
                )}
              </div>
            </SettingsSection>
          </Tooltip.Provider>
        )}
      </SettingsPanel>

      <CreateApiKeyModal
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        workspaceId={workspaceId}
        existingKeyNames={[...workspaceKeys, ...personalKeys].map((k) => k.name)}
        allowPersonalApiKeys={allowPersonalApiKeys}
        canManageWorkspaceKeys={canManageWorkspaceKeys}
        defaultKeyType={defaultKeyType}
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
