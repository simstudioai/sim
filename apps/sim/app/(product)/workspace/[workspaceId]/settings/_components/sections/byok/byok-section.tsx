'use client'

import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  ByokKeyManager,
  type ByokManagerCapabilities,
  type ByokManagerKey,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/byok-key-manager'
import { PROVIDERS } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/providers'
import {
  type BYOKProviderId,
  byokScopeParam,
  byokScopeUrlKeys,
  MAX_BYOK_KEYS_PER_PROVIDER,
  useBYOKKeys,
  useDeleteBYOKKey,
  useDeleteOrganizationBYOKKey,
  useDeploymentShape,
  useInheritedBYOKStatus,
  useOrganizationBYOKKeys,
  useSettingsSearch,
  useUpsertBYOKKey,
  useUpsertOrganizationBYOKKey,
} from '@/platform/lib/data/byok'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

const SCOPE_OPTIONS = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'organization', label: 'Organization' },
] as const

/**
 * The workspace's own provider keys and, for a hosted organization's administrators, the
 * organization's keys every workspace inherits unless it adds its own.
 */
export default function ByokSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { hostContext, canMutate } = useWorkspaceSettingsSection(workspaceId, 'byok')
  const { hosted } = useDeploymentShape()
  const hostOrganizationId = hostContext?.hostOrganizationId ?? null
  const canSelectOrganization = Boolean(
    hosted && hostOrganizationId && hostContext?.viewer.isHostOrganizationAdmin
  )
  const [requestedScope, setRequestedScope] = useQueryState(byokScopeParam.key, {
    ...byokScopeParam.parser,
    ...byokScopeUrlKeys,
  })
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const isOrganizationScope = requestedScope === 'organization' && canSelectOrganization
  const organizationQueryId = isOrganizationScope ? (hostOrganizationId ?? undefined) : undefined
  const inheritedStatusWorkspaceId =
    !isOrganizationScope && hosted && hostOrganizationId ? workspaceId : undefined

  const workspaceKeys = useBYOKKeys(workspaceId)
  const organizationKeys = useOrganizationBYOKKeys(organizationQueryId, {
    enabled: isOrganizationScope,
  })
  const inheritedStatus = useInheritedBYOKStatus(inheritedStatusWorkspaceId)
  const upsertWorkspaceKey = useUpsertBYOKKey()
  const deleteWorkspaceKey = useDeleteBYOKKey()
  const upsertOrganizationKey = useUpsertOrganizationBYOKKey()
  const deleteOrganizationKey = useDeleteOrganizationBYOKKey()

  const activeQuery = isOrganizationScope ? organizationKeys : workspaceKeys
  const isMutating =
    upsertWorkspaceKey.isPending ||
    deleteWorkspaceKey.isPending ||
    upsertOrganizationKey.isPending ||
    deleteOrganizationKey.isPending
  const entitled = organizationKeys.data?.entitled === true

  const capabilities: ByokManagerCapabilities = isOrganizationScope
    ? { add: entitled, update: entitled, delete: true }
    : { add: canMutate, update: canMutate, delete: canMutate }

  const keysByProvider = new Map<string, ByokManagerKey[]>()
  for (const key of activeQuery.data?.keys ?? []) {
    const providerKeys = keysByProvider.get(key.providerId) ?? []
    providerKeys.push({ id: key.id, name: key.name, maskedKey: key.maskedKey })
    keysByProvider.set(key.providerId, providerKeys)
  }

  const inheritedProviderIds = new Set<BYOKProviderId>(
    isOrganizationScope || inheritedStatus.isError
      ? []
      : (inheritedStatus.data?.inheritedProviderIds ?? [])
  )

  const description = isOrganizationScope
    ? organizationKeys.data?.entitled === false
      ? 'Organization keys apply to all current and future workspaces unless a workspace adds its own key. An active organization plan is required to add or update them; existing keys can still be deleted.'
      : 'Organization keys apply to all current and future workspaces unless a workspace adds its own key.'
    : undefined

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search providers'
            placeholder='Search providers...'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      >
        {canSelectOrganization && (
          <ChoiceMenu
            label='Key scope'
            options={SCOPE_OPTIONS}
            value={isOrganizationScope ? 'organization' : 'workspace'}
            disabled={isMutating}
            onValueChange={(scope) =>
              void setRequestedScope(scope === 'organization' ? 'organization' : 'workspace')
            }
          />
        )}
      </SectionToolbar>
      {description && <Muted>{description}</Muted>}
      {!isOrganizationScope && inheritedStatus.isError && (
        <InlineNotice
          intent='warning'
          message='Inherited key status unavailable. Refresh to try again.'
        />
      )}
      {activeQuery.error && activeQuery.data === undefined ? (
        <FailureNotice
          message={getErrorMessage(activeQuery.error, 'Failed to load provider keys')}
          retrying={activeQuery.isFetching}
          onRetry={() => void activeQuery.refetch()}
        />
      ) : activeQuery.isPending ? null : (
        <ByokKeyManager
          key={`${workspaceId}:${isOrganizationScope ? 'organization' : 'workspace'}`}
          providers={PROVIDERS}
          inheritedProviderIds={inheritedProviderIds}
          keysByProvider={keysByProvider}
          maxKeysPerProvider={MAX_BYOK_KEYS_PER_PROVIDER}
          capabilities={capabilities}
          searchTerm={searchTerm}
          scopeLabel={isOrganizationScope ? 'this organization' : 'this workspace'}
          keyUsageDescription={
            isOrganizationScope
              ? 'This key is available to executions in every current and future workspace attached to this organization unless the workspace has its own key for this provider. Create PR, Update PR, and Plan may pass it into the untrusted Pi sandbox; Pi search still requires an explicit block key. Your key is encrypted and stored securely.'
              : undefined
          }
          lastKeyDeleteMessage={
            isOrganizationScope
              ? 'Workspaces without their own key will use their next available configured key source.'
              : hostOrganizationId
                ? 'This workspace will inherit an organization key when available, or use its next available configured key source.'
                : 'This workspace will use its next available configured key source.'
          }
          isDeleting={
            isOrganizationScope ? deleteOrganizationKey.isPending : deleteWorkspaceKey.isPending
          }
          onSaveKey={async ({ providerId, apiKey, keyId, name }) => {
            if (organizationQueryId) {
              await upsertOrganizationKey.mutateAsync({
                organizationId: organizationQueryId,
                providerId,
                apiKey,
                keyId,
                name,
              })
              return
            }
            await upsertWorkspaceKey.mutateAsync({ workspaceId, providerId, apiKey, keyId, name })
          }}
          onDeleteKey={async (providerId, keyId) => {
            if (organizationQueryId) {
              await deleteOrganizationKey.mutateAsync({
                organizationId: organizationQueryId,
                providerId,
                keyId,
              })
              return
            }
            await deleteWorkspaceKey.mutateAsync({ workspaceId, providerId, keyId })
          }}
        />
      )}
    </SectionStack>
  )
}
