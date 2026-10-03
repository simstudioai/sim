'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipConfirmModal, Label, Switch, Tooltip, toast } from '@sim/emcn'
import { CircleInfo, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import type { ApiKey } from '@/lib/api/contracts/api-keys'
import { useSession } from '@/lib/auth/auth-client'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import type { ApiKeyScope } from '@/hooks/queries/api-key-list'
import {
  useApiKeys,
  useDeleteApiKey,
  useUpdateWorkspaceApiKeySettings,
} from '@/hooks/queries/api-keys'
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
    <div className='shrink-0'>
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

interface ApiKeysProps {
  scope?: ApiKeyScope
}

export function ApiKeys({ scope = 'workspace' }: ApiKeysProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = (params?.workspaceId as string) || ''
  const hostContext = useOptionalWorkspaceHostContext()
  const workspacePermissions = useUserPermissionsContext()
  const isWorkspaceScope = scope === 'workspace'
  const isPersonalScope = scope === 'personal'
  const isCombinedScope = scope === 'combined'
  const showsWorkspaceKeys = isWorkspaceScope || isCombinedScope
  const showsPersonalKeys = isPersonalScope || isCombinedScope
  const canManageWorkspaceKeys = canMutateWorkspaceSettingsSection('api-keys', workspacePermissions)

  const {
    data: apiKeysData,
    isLoading: isLoadingKeys,
    error: apiKeysError,
    refetch: refetchApiKeys,
  } = useApiKeys(workspaceId, scope)
  const deleteApiKeyMutation = useDeleteApiKey()
  const updateSettingsMutation = useUpdateWorkspaceApiKeySettings()

  const workspaceKeys = apiKeysData?.workspaceKeys ?? EMPTY_KEYS
  const personalKeys = apiKeysData?.personalKeys ?? EMPTY_KEYS
  const conflicts = apiKeysData?.conflicts ?? EMPTY_KEY_NAMES
  const conflictNames = useMemo(() => new Set(conflicts), [conflicts])
  const isLoading = isLoadingKeys

  /**
   * The raw group config, not `usePermissionConfig` — that hook also projects
   * block and model availability, which would pull the block registry into this
   * settings page's module graph for one boolean.
   */
  const permissionConfigQuery = useUserPermissionConfig(workspaceId)

  /**
   * Both layers have to agree. The workspace column is the coarse switch every
   * workspace has; the permission group narrows it for one cohort inside an
   * enterprise organization. The server combines them the same way, so offering
   * a key type here that it would refuse is the only failure worth avoiding —
   * which is why the policy fails closed while its query is pending or errored,
   * rather than treating an unanswered question as an unrestricted answer.
   * `useUserPermissionConfig` retries and refetches on remount, which is what
   * makes the gate self-healing rather than sticky.
   *
   * `isSuccess` and not `isSuccess && !isFetching`, on purpose. A background
   * refetch of an already-answered policy keeps the cached answer, and the
   * fail-closed window that matters — the first load, where there is nothing
   * cached — is already covered because `isSuccess` is false until the first
   * response. Re-closing on every refetch would instead blank the personal-key
   * affordance and flip the create default to `workspace` on each window focus,
   * for a policy that changes on the order of never. This gate is the
   * affordance; `/api/workspaces/[id]/api-keys` is the enforcement, and it
   * re-reads the group on the request itself, so the seconds of staleness cost
   * a user a refused create at worst.
   *
   * The `!workspaceId` arm covers the account plane, which renders this
   * component as `scope='personal'` outside `/workspace/[workspaceId]`: the
   * hook is disabled there and nothing reads the result — a personal key is
   * not a workspace's to withhold, and `/api/users/me/api-keys` remains the
   * enforcement for the user-global `api_keys.manage` policy.
   */
  const permissionPolicyReady = !workspaceId || permissionConfigQuery.isSuccess

  /**
   * The stored workspace column alone. The admin switch below binds to this,
   * not to the combined policy — a group's `disablePersonalApiKeys` must not
   * render the stored setting as off, or toggling it "on" fires a successful
   * mutation with no visible effect.
   */
  const storedAllowPersonalApiKeys = hostContext?.workspace.allowPersonalApiKeys ?? true

  const allowPersonalApiKeys =
    storedAllowPersonalApiKeys &&
    permissionPolicyReady &&
    !permissionConfigQuery.data?.config?.disablePersonalApiKeys

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useSettingsSearch()

  const defaultKeyType = isPersonalScope
    ? 'personal'
    : isCombinedScope && allowPersonalApiKeys
      ? 'personal'
      : 'workspace'
  const createButtonDisabled =
    isLoading ||
    (Boolean(apiKeysError) && apiKeysData === undefined) ||
    (isWorkspaceScope && !canManageWorkspaceKeys) ||
    (isCombinedScope && !allowPersonalApiKeys && !canManageWorkspaceKeys)

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
      setShowDeleteDialog(false)
      setDeleteKey(null)

      const keyType =
        scope === 'combined'
          ? workspaceKeys.some((key) => key.id === deleteKey.id)
            ? 'workspace'
            : 'personal'
          : scope

      await deleteApiKeyMutation.mutateAsync({
        workspaceId,
        keyId: deleteKey.id,
        keyType,
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
          <SettingsEmptyState tone='error'>
            {getErrorMessage(apiKeysError, 'Failed to load API keys')}
          </SettingsEmptyState>
        ) : isLoading ? null : personalKeys.length === 0 && workspaceKeys.length === 0 ? (
          <SettingsEmptyState>Click "Create API key" above to get started</SettingsEmptyState>
        ) : (
          <div className='flex flex-col gap-6'>
            {showsWorkspaceKeys && !searchTerm.trim() ? (
              <SettingsSection label='Workspace'>
                {workspaceKeys.length === 0 ? (
                  <SettingsEmptyState variant='inline'>
                    No workspace API keys yet
                  </SettingsEmptyState>
                ) : (
                  <div className={RESOURCE_LIST_STACK}>
                    {workspaceKeys.map((key) => (
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
                            canDelete={canManageWorkspaceKeys}
                          />
                        }
                      />
                    ))}
                  </div>
                )}
              </SettingsSection>
            ) : showsWorkspaceKeys && filteredWorkspaceKeys.length > 0 ? (
              <SettingsSection label='Workspace'>
                <div className={RESOURCE_LIST_STACK}>
                  {filteredWorkspaceKeys.map(({ key }) => (
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
                          canDelete={canManageWorkspaceKeys}
                        />
                      }
                    />
                  ))}
                </div>
              </SettingsSection>
            ) : null}

            {showsPersonalKeys && (!searchTerm.trim() || filteredPersonalKeys.length > 0) && (
              <SettingsSection label='Personal'>
                <div className={RESOURCE_LIST_STACK}>
                  {filteredPersonalKeys.map(({ key }) => {
                    const isConflict = conflictNames.has(key.name)
                    return (
                      <div key={key.id} className='flex flex-col'>
                        <SettingsResourceRow
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
                        {isConflict && (
                          <p className='text-[var(--text-error)] text-caption leading-tight'>
                            Workspace API key with the same name overrides this. Rename your
                            personal key to use it.
                          </p>
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

        {showsWorkspaceKeys && !isLoading && canManageWorkspaceKeys && (
          <Tooltip.Provider delayDuration={150}>
            <SettingsSection label='Permissions'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor='allow-personal-api-keys'>Allow personal API keys</Label>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Chip leftIcon={CircleInfo} aria-label='About personal API keys' />
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top' className='max-w-xs text-small'>
                      Allow collaborators to authenticate with their own keys. Hosted usage is
                      billed to this workspace, attributed to the key owner, and counted toward
                      their member cap.
                    </Tooltip.Content>
                  </Tooltip.Root>
                </div>
                <Switch
                  id='allow-personal-api-keys'
                  checked={storedAllowPersonalApiKeys}
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
        allowPersonalApiKeys={isPersonalScope || (isCombinedScope && allowPersonalApiKeys)}
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
