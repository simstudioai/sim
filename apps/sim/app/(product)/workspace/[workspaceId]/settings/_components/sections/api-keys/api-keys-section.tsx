'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { CreateApiKeyModal } from '@/app/(product)/workspace/[workspaceId]/_components/create-api-key-modal/create-api-key-modal'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
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

const PERSONAL_KEYS_DESCRIPTION =
  'Let collaborators use their own keys, with hosted usage billed to this workspace'

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
  const lastUsed = apiKey.lastUsed ? formatInstantDate(apiKey.lastUsed) : 'never'
  const expiry = apiKey.expiresAt
    ? Date.parse(apiKey.expiresAt) <= Date.now()
      ? ' · expired'
      : ` · expires ${formatInstantDate(apiKey.expiresAt)}`
    : ''
  return (
    <SettingsRow
      label={apiKey.name}
      description={`${apiKey.displayKey} · last used ${lastUsed}${expiry}${
        overridden ? ' · a workspace key has this name' : ''
      }`}
    >
      <>
        {apiKey.access === 'read' && <StatusTag label='Read only' />}
        {overridden && <StatusTag label='Overridden' intent='danger' />}
        <ActionMenu
          label={`Actions for ${apiKey.name}`}
          icon='I108'
          align='end'
          actions={[
            {
              id: 'delete',
              label: 'Delete',
              destructive: true,
              disabled: !canDelete,
              onSelect: onDelete,
            },
          ]}
        />
      </>
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

  const canCreate = allowPersonalApiKeys || canManageWorkspaceKeys

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

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SettingsRead query={keys} failureMessage='Couldn’t load API keys'>
        {(data) => (
          <>
            {data.workspaceKeys.length + data.personalKeys.length > 0 && (
              <SectionToolbar
                grow={
                  <SearchField
                    label='Search API keys'
                    placeholder='Search API keys…'
                    value={search}
                    onValueChange={setSearch}
                  />
                }
              />
            )}
            <SettingsList
              title='Workspace'
              empty={
                visibleWorkspaceKeys.length > 0
                  ? undefined
                  : {
                      title: searching
                        ? 'No matching workspace API keys'
                        : 'No workspace API keys yet',
                    }
              }
            >
              {visibleWorkspaceKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  canDelete={canManageWorkspaceKeys}
                  onDelete={() => setDeleting({ key, keyType: 'workspace' })}
                />
              ))}
            </SettingsList>
            <SettingsList
              title='Personal'
              empty={
                visiblePersonalKeys.length > 0
                  ? undefined
                  : {
                      title: searching
                        ? 'No matching personal API keys'
                        : 'No personal API keys yet',
                    }
              }
            >
              {visiblePersonalKeys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  overridden={conflicts.has(key.name)}
                  canDelete
                  onDelete={() => setDeleting({ key, keyType: 'personal' })}
                />
              ))}
            </SettingsList>
            <SettingsSection title='Manage'>
              <SettingsRow
                label='New API key'
                description='Authenticate the Sim API and SDKs as this workspace or as you'
              >
                <Button
                  size='compact'
                  icon='I074'
                  disabled={!canCreate}
                  disabledReason='Personal API keys are turned off for this workspace'
                  onClick={() => setCreating(true)}
                >
                  Create API key
                </Button>
              </SettingsRow>
              {canManageWorkspaceKeys && (
                <SwitchRow
                  label='Allow personal API keys'
                  description={PERSONAL_KEYS_DESCRIPTION}
                  checked={storedAllowPersonalApiKeys}
                  disabled={updateSettings.isPending}
                  onCheckedChange={(checked) =>
                    void updateSettings
                      .mutateAsync({ workspaceId, allowPersonalApiKeys: checked })
                      .catch((error: unknown) => {
                        logger.error('Error updating workspace settings', { error })
                        toast.error(getErrorMessage(error, 'Couldn’t update API key settings'))
                      })
                  }
                />
              )}
            </SettingsSection>
          </>
        )}
      </SettingsRead>
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
