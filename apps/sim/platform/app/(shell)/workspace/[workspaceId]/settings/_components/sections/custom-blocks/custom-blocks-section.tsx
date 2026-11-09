'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ResourceList,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/section-registry'
import { CustomBlockDetail } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/custom-blocks/custom-block-detail'
import {
  useCanPublishCustomBlock,
  useCustomBlockParam,
  useCustomBlocks,
  useSettingsSearch,
  useWhitelabelSettings,
  useWorkspacesQuery,
} from '@/platform/lib/data/custom-blocks'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

/** The organization's custom blocks available here, and publishing a workflow as one. */
export default function CustomBlocksSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canAdmin, hostContext } = useWorkspaceSettingsSection(
    workspaceId,
    'custom-blocks'
  )
  const access = useCanPublishCustomBlock(workspaceId)
  const { data: blocks = [] } = useCustomBlocks(workspaceId)
  const { data: workspaces = [] } = useWorkspacesQuery()
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

  // The list read also answers the entitlement, so a deep link never flashes the list first.
  if (access.isPending) return null

  if (access.data === undefined)
    return (
      <FailureNotice
        message={getErrorMessage(access.error, 'Failed to load custom block access')}
        retrying={access.isFetching}
        onRetry={() => void access.refetch()}
      />
    )

  if (!access.data)
    return (
      <EmptyState title='Custom blocks require an Enterprise plan. Contact your admin to enable them.' />
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
      <SectionToolbar
        grow={
          <SearchField
            label='Search custom blocks'
            placeholder='Search custom blocks...'
            value={search}
            onValueChange={setSearch}
          />
        }
      />
      <SettingsSection title='Blocks'>
        {blocks.length === 0 ? (
          <EmptyState
            title='No custom blocks yet'
            description={canCreate ? 'Create a block to publish a workflow as a block.' : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={`No blocks found matching "${search}"`} />
        ) : (
          <ResourceList>
            {filtered.map((block) => {
              const iconUrl = block.iconUrl || fallbackIconUrl
              const leading = iconUrl ? (
                <Avatar name={block.name} src={iconUrl} organization size='row' decorative />
              ) : (
                <Icon name='I025' />
              )
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
          <SettingsRow label='New custom block'>
            <Button size='compact' icon='I074' onClick={() => setIsCreating(true)}>
              Create block
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
    </SectionStack>
  )
}
