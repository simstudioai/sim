'use client'

import { useMemo, useState } from 'react'
import { ChipTag } from '@sim/emcn'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  customBlockIdParam,
  customBlockIdUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { getCustomBlockIcon } from '@/blocks/custom/custom-block-icon'
import { CustomBlockDetail } from '@/ee/custom-blocks/components/custom-block-detail'
import { useOrgBrandConfig } from '@/ee/whitelabeling/components/branding-provider'
import { useCanPublishCustomBlock, useCustomBlocks } from '@/hooks/queries/custom-blocks'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

export function CustomBlocks() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined
  const workspacePermissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('custom-blocks', workspacePermissions)
  const permissionsLoading = workspacePermissions.isLoading

  const { data: canManage = false, isLoading } = useCanPublishCustomBlock(workspaceId)
  const { data: blocks = [] } = useCustomBlocks(workspaceId)
  const { data: workspaces = [] } = useWorkspacesQuery()

  /** Publishing requires admin on a source workspace; viewing remains workspace-scoped. */
  const currentOrgId = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.organizationId ?? null,
    [workspaces, workspaceId]
  )
  const canCreate = useMemo(
    () =>
      !!currentOrgId &&
      canAdmin &&
      workspaces.some((w) => w.organizationId === currentOrgId && w.permissions === 'admin'),
    [canAdmin, workspaces, currentOrgId]
  )
  const fallbackIconUrl = useOrgBrandConfig().logoUrl ?? null

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedBlockId, setSelectedBlockId] = useQueryState(customBlockIdParam.key, {
    ...customBlockIdParam.parser,
    ...customBlockIdUrlKeys,
  })
  /** The create flow has no entity id and is not deep-linkable — stays local. */
  const [isCreating, setIsCreating] = useState(false)

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return blocks
    const q = searchTerm.toLowerCase()
    return blocks.filter((b) => b.name.toLowerCase().includes(q))
  }, [blocks, searchTerm])

  /** Open the detail only once the deep-linked id resolves to a loaded block. */
  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) : undefined

  /**
   * Hold the first paint while a deep-linked id could still resolve — the
   * blocks query (`isLoading`, shared with `useCanPublishCustomBlock`) and the
   * permissions context both gate the detail, so a valid link never flashes
   * the list before jumping to it. A dead id still falls back to the list.
   */
  if (isLoading || (selectedBlockId !== null && permissionsLoading)) return null

  if (!canManage) {
    return (
      <SettingsEmptyState>
        Custom blocks require an Enterprise plan. Contact your admin to enable them.
      </SettingsEmptyState>
    )
  }

  if ((isCreating || (selectedBlock && canAdmin)) && workspaceId) {
    return (
      <CustomBlockDetail
        key={isCreating ? 'new' : selectedBlock?.id}
        blockId={isCreating ? null : (selectedBlock?.id ?? null)}
        workspaceId={workspaceId}
        onBack={() => {
          setIsCreating(false)
          void setSelectedBlockId(null, { history: 'replace' })
        }}
      />
    )
  }

  return (
    <SettingsPanel
      search={{
        value: searchTerm,
        onChange: setSearchTerm,
        placeholder: 'Search custom blocks...',
      }}
      actions={
        canCreate
          ? [
              {
                text: 'Create block',
                icon: Plus,
                variant: 'primary',
                onSelect: () => setIsCreating(true),
              },
            ]
          : []
      }
    >
      <SettingsSection label={`Blocks (${blocks.length})`}>
        {blocks.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            {canCreate
              ? 'No custom blocks yet. Click "Create block" to publish a workflow as a block.'
              : 'No custom blocks yet.'}
          </SettingsEmptyState>
        ) : filtered.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            No blocks found matching "{searchTerm}"
          </SettingsEmptyState>
        ) : (
          <div className='-mx-2 flex flex-col gap-y-0.5'>
            {filtered.map((cb) => {
              const Icon = getCustomBlockIcon(cb.iconUrl, fallbackIconUrl)
              return (
                <button
                  key={cb.id}
                  type='button'
                  onClick={() => canAdmin && void setSelectedBlockId(cb.id)}
                  className='w-full rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                  disabled={!canAdmin}
                >
                  <SettingsResourceRow
                    icon={<Icon />}
                    iconFill
                    title={cb.name}
                    description={cb.description || undefined}
                    trailing={
                      <div className='flex flex-shrink-0 items-center gap-2'>
                        {!cb.enabled && <ChipTag variant='gray'>Disabled</ChipTag>}
                        {canAdmin && <ArrowRight className='size-4 text-[var(--text-icon)]' />}
                      </div>
                    }
                  />
                </button>
              )
            })}
          </div>
        )}
      </SettingsSection>
    </SettingsPanel>
  )
}
