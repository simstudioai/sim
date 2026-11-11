'use client'

import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import { InlineNotice } from '@sim/emcn/status'
import { useQueryState } from 'nuqs'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  type ByokKeyActions,
  type ByokManagerCapabilities,
  type ByokManagerKey,
  ByokProviderKeys,
  ByokProviderList,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/byok-key-manager'
import { PROVIDERS } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/byok/providers'
import {
  type BYOKProviderId,
  byokScopeParam,
  byokScopeUrlKeys,
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
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
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
  const subview = useSettingsSubview({ idParam: 'provider' })
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
      ? 'Organization keys apply to every workspace without its own key. Adding or updating one needs an active organization plan'
      : 'Organization keys apply to every workspace without its own key'
    : undefined

  const keyActions: ByokKeyActions = {
    keysByProvider,
    capabilities,
    keyUsageDescription: isOrganizationScope
      ? 'Every workspace in this organization uses this key unless it adds its own'
      : undefined,
    lastKeyDeleteMessage: isOrganizationScope
      ? 'Workspaces without their own key will use their next available configured key source.'
      : hostOrganizationId
        ? 'This workspace will inherit an organization key when available, or use its next available configured key source.'
        : 'This workspace will use its next available configured key source.',
    isDeleting: isOrganizationScope
      ? deleteOrganizationKey.isPending
      : deleteWorkspaceKey.isPending,
    onSaveKey: async ({ providerId, apiKey, keyId, name }) => {
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
    },
    onDeleteKey: async (providerId, keyId) => {
      if (organizationQueryId) {
        await deleteOrganizationKey.mutateAsync({
          organizationId: organizationQueryId,
          providerId,
          keyId,
        })
        return
      }
      await deleteWorkspaceKey.mutateAsync({ workspaceId, providerId, keyId })
    },
  }

  const openProviderId = PROVIDERS.find((provider) => provider.id === subview.id)?.id
  if (openProviderId && activeQuery.isPending) return null
  if (openProviderId && activeQuery.data !== undefined) {
    return (
      <ByokProviderKeys providerId={openProviderId} onBack={subview.close} actions={keyActions} />
    )
  }

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SectionToolbar
        grow={
          <SearchField
            label='Search providers'
            placeholder='Search providers…'
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
      <SettingsRead query={activeQuery} failureMessage='Couldn’t load provider keys'>
        {() => (
          <ByokProviderList
            key={`${workspaceId}:${isOrganizationScope ? 'organization' : 'workspace'}`}
            inheritedProviderIds={inheritedProviderIds}
            searchTerm={searchTerm}
            onOpenProvider={subview.open}
            actions={keyActions}
          />
        )}
      </SettingsRead>
    </SectionStack>
  )
}
