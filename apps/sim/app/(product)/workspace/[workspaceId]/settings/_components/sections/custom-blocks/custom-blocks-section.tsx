'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { CustomBlockDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-block-detail'
import { UpgradeNotice } from '@/app/(product)/workspace/[workspaceId]/settings/_components/upgrade-notice/upgrade-notice'
import {
  customBlockIdParam,
  useCanPublishCustomBlock,
  useCustomBlocks,
  useSettingsSearch,
  useWhitelabelSettings,
  useWorkspacesQuery,
} from '@/platform/lib/data/custom-blocks'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

function blockGlyph(name: string, iconUrl: string | null) {
  return iconUrl ? (
    <Avatar name={name} src={iconUrl} organization size='row' decorative />
  ) : (
    <Icon name='I025' />
  )
}

/** The organization's custom blocks available here, and publishing a workflow as one. */
export default function CustomBlocksSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canAdmin, hostContext } = useWorkspaceSettingsSection(
    workspaceId,
    'custom-blocks'
  )
  const access = useCanPublishCustomBlock(workspaceId)
  const blocksQuery = useCustomBlocks(workspaceId)
  // Placeholder data is another workspace's blocks reading as success, so it counts as loading.
  const blocksLoading = blocksQuery.isPending || blocksQuery.isPlaceholderData
  const workspacesQuery = useWorkspacesQuery()
  const workspaces = workspacesQuery.data ?? []
  // A block without an uploaded icon shows the host organization's logo, as the legacy branding did.
  const { data: whitelabel } = useWhitelabelSettings(
    hostContext?.viewer.isHostOrganizationMember
      ? (hostContext.hostOrganizationId ?? undefined)
      : undefined
  )
  const fallbackIconUrl = whitelabel?.settings.logoUrl ?? null

  // Publishing needs administration of a source workspace in this organization.
  const currentOrgId = workspaces.find((w) => w.id === workspaceId)?.organizationId ?? null
  const canCreate =
    Boolean(currentOrgId) &&
    canAdmin &&
    workspaces.some((w) => w.organizationId === currentOrgId && w.permissions === 'admin')

  const [search, setSearch] = useSettingsSearch()
  const subview = useSettingsSubview({
    idParam: customBlockIdParam.key,
    createParam: 'create-custom-block',
  })
  const selectedBlock = subview.id
    ? blocksQuery.data?.find((block) => block.id === subview.id)
    : undefined
  const deepLinked = subview.id !== null || subview.creating

  // The list read also answers the entitlement, so a deep link never flashes the list first.
  if (access.isPending) return deepLinked ? null : <SettingsPageHeader />
  if (subview.id !== null && blocksLoading) return null

  if (access.data === undefined)
    return (
      <SectionStack>
        <SettingsPageHeader />
        <FailureNotice
          message={getErrorMessage(access.error, 'Couldn’t load custom block access')}
          retrying={access.isFetching}
          onRetry={() => void access.refetch()}
        />
      </SectionStack>
    )

  if (!access.data)
    return (
      <SectionStack>
        <SettingsPageHeader />
        <UpgradeNotice
          title='Custom blocks require an Enterprise plan'
          description='Ask your organization’s admin to enable them'
          canUpgrade={false}
        />
      </SectionStack>
    )

  if ((subview.creating && canCreate) || selectedBlock)
    return (
      <CustomBlockDetail
        key={subview.creating ? 'new' : selectedBlock?.id}
        existing={subview.creating ? null : (selectedBlock ?? null)}
        workspaceId={workspaceId}
        onBack={subview.close}
      />
    )

  const createBlock = canCreate ? (
    <Button size='compact' icon='I074' onClick={subview.create}>
      Create block
    </Button>
  ) : undefined

  return (
    <SectionStack>
      <SettingsPageHeader />
      {workspacesQuery.isError && workspacesQuery.data === undefined && (
        <FailureNotice
          message={getErrorMessage(workspacesQuery.error, 'Couldn’t load your workspaces')}
          retrying={workspacesQuery.isFetching}
          onRetry={() => void workspacesQuery.refetch()}
        />
      )}
      <SettingsRead query={blocksQuery} failureMessage='Couldn’t load custom blocks'>
        {(blocks) => {
          if (blocksLoading) return null
          const query = search.trim().toLowerCase()
          const filtered = query
            ? blocks.filter((block) => block.name.toLowerCase().includes(query))
            : blocks
          return (
            <>
              {blocks.length > 0 && (
                <SectionToolbar
                  grow={
                    <SearchField
                      label='Search custom blocks'
                      placeholder='Search custom blocks…'
                      value={search}
                      onValueChange={setSearch}
                    />
                  }
                />
              )}
              <SettingsList
                title='Blocks'
                empty={
                  blocks.length === 0
                    ? {
                        title: 'No custom blocks yet',
                        description: canCreate
                          ? 'Publish a deployed workflow as a reusable block'
                          : undefined,
                        action: createBlock,
                      }
                    : filtered.length === 0
                      ? { title: 'No matching blocks' }
                      : undefined
                }
              >
                <ResourceList>
                  {filtered.map((block) => (
                    <ActivityRow
                      key={block.id}
                      leading={blockGlyph(block.name, block.iconUrl || fallbackIconUrl)}
                      title={block.name}
                      detail={block.description || undefined}
                      textMetadata={block.enabled ? undefined : 'Disabled'}
                      onOpen={() => subview.open(block.id)}
                    />
                  ))}
                </ResourceList>
                {createBlock && (
                  <SettingsRow
                    label='New custom block'
                    description='Publish a deployed workflow as a reusable block'
                  >
                    {createBlock}
                  </SettingsRow>
                )}
              </SettingsList>
            </>
          )
        }}
      </SettingsRead>
    </SectionStack>
  )
}
