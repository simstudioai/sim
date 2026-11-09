'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import { CreateApiKeyModal } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/create-api-key-modal/create-api-key-modal'
import type { WorkspaceSettingsSectionProps } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/section-registry'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/api-keys/api-keys.module.css'
import {
  type ApiKey,
  createLogger,
  useApiKeys,
  useDeleteApiKey,
  useSession,
  useSettingsSearch,
  useUpdateWorkspaceApiKeySettings,
  useUserPermissionConfig,
} from '@/platform/lib/data/api-keys'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { formatInstantDate } from '@/platform/shared/time'

const logger = createLogger('ApiKeysSection')

const PERSONAL_KEYS_HINT =
  'Allow collaborators to authenticate with their own keys. Hosted usage is billed to this workspace, attributed to the key owner, and counted toward their member cap.'

interface DeleteTarget {
  key: ApiKey
  keyType: 'workspace' | 'personal'
}

interface ApiKeyRowProps {
  apiKey: ApiKey
  /** The workspace key of the same name that wins over this personal key. */
  overridden?: boolean
  /** False keeps Delete visible but unavailable, for a non-admin on a workspace key. */
  canDelete: boolean
  onDelete: () => void
}

function ApiKeyRow({ apiKey, overridden = false, canDelete, onDelete }: ApiKeyRowProps) {
  const { copy } = useClipboard()
  const lastUsed = apiKey.lastUsed ? formatInstantDate(apiKey.lastUsed) : 'never'
  return (
    <SettingsRow
      label={apiKey.name}
      description={`${apiKey.displayKey} · last used ${lastUsed}${
        overridden
          ? ' · A workspace API key with the same name overrides this. Rename your personal key to use it.'
          : ''
      }`}
    >
      <span className={styles.controls}>
        {overridden && <StatusTag label='Overridden' intent='danger' />}
        <ActionMenu
          label={`Actions for ${apiKey.name}`}
          icon='I108'
          align='end'
          actions={[
            {
              id: 'copy',
              label: 'Copy name',
              onSelect: () =>
                void copy(apiKey.name).then((copied) => {
                  if (copied) toast.success('Copied name to clipboard')
                }),
            },
            {
              id: 'delete',
              label: 'Delete',
              destructive: true,
              separatorBefore: true,
              disabled: !canDelete,
              onSelect: onDelete,
            },
          ]}
        />
      </span>
    </SettingsRow>
  )
}

/**
 * The workspace's Sim API keys beside the viewer's personal keys, as legacy's combined scope lists
 * them, with the workspace switch that allows personal keys.
 */
export default function ApiKeysSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { hostContext, canMutate: canManageWorkspaceKeys } = useWorkspaceSettingsSection(
    workspaceId,
    'api-keys'
  )
  const { data: session } = useSession()
  const userId = session?.user?.id
  const keys = useApiKeys(workspaceId, 'combined')
  const deleteApiKey = useDeleteApiKey()
  const updateSettings = useUpdateWorkspaceApiKeySettings()
  const permissionConfig = useUserPermissionConfig(workspaceId)
  const [search, setSearch] = useSettingsSearch()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)

  const workspaceKeys = keys.data?.workspaceKeys ?? []
  const personalKeys = keys.data?.personalKeys ?? []
  const conflicts = new Set(keys.data?.conflicts ?? [])

  /**
   * The stored workspace column, which the admin switch binds to. A permission group's
   * `disablePersonalApiKeys` narrows what may be created, never what the switch shows.
   */
  const storedAllowPersonalApiKeys = hostContext?.workspace.allowPersonalApiKeys ?? true
  /** Fails closed until the permission group answers, as the server combines both layers. */
  const allowPersonalApiKeys =
    storedAllowPersonalApiKeys &&
    permissionConfig.isSuccess &&
    !permissionConfig.data?.config?.disablePersonalApiKeys

  const loadFailed = Boolean(keys.error) && keys.data === undefined
  const createDisabled =
    keys.isLoading || loadFailed || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

  const term = search.trim().toLowerCase()
  const searching = term !== ''
  const matches = (key: ApiKey) => !searching || key.name.toLowerCase().includes(term)
  const visibleWorkspaceKeys = workspaceKeys.filter(matches)
  const visiblePersonalKeys = personalKeys.filter(matches)

  const confirmDelete = async ({ key, keyType }: DeleteTarget) => {
    if (!userId) return
    try {
      await deleteApiKey.mutateAsync({ workspaceId, keyId: key.id, keyType })
    } catch (error) {
      logger.error('Error deleting API key', { error })
      throw error
    }
  }

  const keyList = loadFailed ? (
    <FailureNotice
      message={getErrorMessage(keys.error, 'Failed to load API keys')}
      retrying={keys.isFetching}
      onRetry={() => void keys.refetch()}
    />
  ) : keys.isLoading ? null : workspaceKeys.length === 0 && personalKeys.length === 0 ? (
    <EmptyState title='No API keys yet' description='Create an API key to get started.' />
  ) : searching && visibleWorkspaceKeys.length === 0 && visiblePersonalKeys.length === 0 ? (
    <EmptyState title={`No API keys found matching "${search}"`} />
  ) : (
    <>
      {(!searching || visibleWorkspaceKeys.length > 0) && (
        <SettingsSection title='Workspace'>
          {workspaceKeys.length === 0 ? (
            <p className={styles.status} data-type='T060'>
              No workspace API keys yet
            </p>
          ) : (
            visibleWorkspaceKeys.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                canDelete={canManageWorkspaceKeys}
                onDelete={() => setDeleting({ key, keyType: 'workspace' })}
              />
            ))
          )}
        </SettingsSection>
      )}
      {(!searching || visiblePersonalKeys.length > 0) && (
        <SettingsSection title='Personal'>
          {visiblePersonalKeys.map((key) => (
            <ApiKeyRow
              key={key.id}
              apiKey={key}
              overridden={conflicts.has(key.name)}
              canDelete
              onDelete={() => setDeleting({ key, keyType: 'personal' })}
            />
          ))}
        </SettingsSection>
      )}
    </>
  )

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search API keys'
            placeholder='Search API keys...'
            value={search}
            onValueChange={setSearch}
          />
        }
      >
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={createDisabled}
          onClick={() => setCreating(true)}
        >
          Create API key
        </Button>
      </SectionToolbar>
      {keyList}
      {!keys.isLoading && canManageWorkspaceKeys && (
        <SettingsSection title='Permissions'>
          <SettingsRow label='Allow personal API keys' description={PERSONAL_KEYS_HINT}>
            <Switch
              label='Allow personal API keys'
              checked={storedAllowPersonalApiKeys}
              disabled={updateSettings.isPending}
              onCheckedChange={(checked) =>
                void updateSettings
                  .mutateAsync({ workspaceId, allowPersonalApiKeys: checked })
                  .catch((error: unknown) =>
                    logger.error('Error updating workspace settings', { error })
                  )
              }
            />
          </SettingsRow>
        </SettingsSection>
      )}
      {creating && (
        <CreateApiKeyModal
          workspaceId={workspaceId}
          existingKeyNames={[...workspaceKeys, ...personalKeys].map((key) => key.name)}
          allowPersonalApiKeys={allowPersonalApiKeys}
          canManageWorkspaceKeys={canManageWorkspaceKeys}
          defaultKeyType={allowPersonalApiKeys ? 'personal' : 'workspace'}
          source='settings'
          onClose={() => setCreating(false)}
        />
      )}
      <ConfirmDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        title='Delete API key'
        description={({ key }) =>
          `Deleting ${key.name} will immediately revoke access for any integrations using it. This action cannot be undone.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={confirmDelete}
      />
    </SectionStack>
  )
}
