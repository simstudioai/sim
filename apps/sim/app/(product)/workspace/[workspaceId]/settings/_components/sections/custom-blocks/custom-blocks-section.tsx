'use client'

import { useEffect, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { CustomBlockDetail } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-block-detail'
import {
  useCanPublishCustomBlock,
  useCustomBlockParam,
  useCustomBlocks,
  useSettingsSearch,
  useWhitelabelSettings,
  useWorkspacesQuery,
} from '@/platform/lib/data/custom-blocks'
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
  const blocks = blocksQuery.data ?? []
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
  const [selectedBlockId, setSelectedBlockId] = useCustomBlockParam()
  /** The create flow has no entity id and is not deep-linkable, so it stays local. */
  const [isCreating, setIsCreating] = useState(false)
  const selectedBlock = selectedBlockId
    ? blocks.find((block) => block.id === selectedBlockId)
    : undefined
  // A `?block=` the settled list does not hold (deleted, or never this workspace's) leaves the URL.
  const unknownBlock =
    Boolean(selectedBlockId) &&
    blocksQuery.data !== undefined &&
    !blocksQuery.isPlaceholderData &&
    !selectedBlock
  useEffect(() => {
    if (unknownBlock) void setSelectedBlockId(null, { history: 'replace' })
  }, [unknownBlock, setSelectedBlockId])

  // The list read also answers the entitlement, so a deep link never flashes the list first.
  if (access.isPending) return selectedBlockId === null ? <SettingsPageHeader /> : null

  if (access.data === undefined)
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice
          message={getErrorMessage(access.error, 'Failed to load custom block access')}
          retrying={access.isFetching}
          onRetry={() => void access.refetch()}
        />
      </>
    )

  if (!access.data)
    return (
      <>
        <SettingsPageHeader />
        <EmptyState title='Custom blocks require an Enterprise plan. Contact your admin to enable them.' />
      </>
    )

  if (isCreating || (selectedBlock && canAdmin))
    return (
      <CustomBlockDetail
        key={isCreating ? 'new' : selectedBlock?.id}
        existing={isCreating ? null : (selectedBlock ?? null)}
        workspaceId={workspaceId}
        onBack={() => {
          setIsCreating(false)
          void setSelectedBlockId(null, { history: 'replace' })
        }}
      />
    )

  const query = search.trim().toLowerCase()
  const filtered = query
    ? blocks.filter((block) => block.name.toLowerCase().includes(query))
    : blocks

  return (
    <SectionStack>
      <SettingsPageHeader />
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
      {workspacesQuery.isError && workspacesQuery.data === undefined && (
        <FailureNotice
          message={getErrorMessage(workspacesQuery.error, 'Failed to load your workspaces')}
          retrying={workspacesQuery.isFetching}
          onRetry={() => void workspacesQuery.refetch()}
        />
      )}
      <SettingsSection title='Blocks'>
        {blocks.length === 0 ? (
          <EmptyState
            title='No custom blocks yet'
            description={canCreate ? 'Create a block to publish a workflow as a block.' : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title='No matching blocks' />
        ) : (
          <ResourceList>
            {filtered.map((block) => {
              const leading = blockGlyph(block.name, block.iconUrl || fallbackIconUrl)
              const metadata = block.enabled ? undefined : 'Disabled'
              return canAdmin ? (
                <ActivityRow
                  key={block.id}
                  leading={leading}
                  title={block.name}
                  detail={block.description || undefined}
                  textMetadata={metadata}
                  onOpen={() => void setSelectedBlockId(block.id)}
                />
              ) : (
                <ActivityRow
                  key={block.id}
                  leading={leading}
                  title={block.name}
                  detail={block.description || undefined}
                  textMetadata={metadata}
                  readOnly
                />
              )
            })}
          </ResourceList>
        )}
        {canCreate && (
          <SettingsRow
            label='New custom block'
            description='Publish a deployed workflow as a reusable block'
          >
            <Button size='compact' icon='I074' onClick={() => setIsCreating(true)}>
              Create block
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
    </SectionStack>
  )
}
