'use client'

import { useMemo, useState } from 'react'
import { ChipTag } from '@sim/emcn'
import { ArrowRight, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { getCustomBlockIcon } from '@/blocks/custom/custom-block-icon'
import { CustomBlockDetail } from '@/ee/custom-blocks/components/custom-block-detail'
import { useWhitelabelSettings } from '@/ee/whitelabeling/hooks/whitelabel'
import { useCanPublishCustomBlock, useCustomBlocks } from '@/hooks/queries/custom-blocks'

export function CustomBlocks() {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : undefined

  const { data: canManage = false, isLoading } = useCanPublishCustomBlock(workspaceId)
  const { data: blocks = [] } = useCustomBlocks(workspaceId)
  const { data: whitelabel } = useWhitelabelSettings(blocks[0]?.organizationId)
  const fallbackIconUrl = whitelabel?.logoUrl ?? null

  const [searchTerm, setSearchTerm] = useState('')
  const [selected, setSelected] = useState<string | 'new' | null>(null)

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return blocks
    const q = searchTerm.toLowerCase()
    return blocks.filter((b) => b.name.toLowerCase().includes(q))
  }, [blocks, searchTerm])

  if (isLoading) return null

  if (!canManage) {
    return (
      <SettingsEmptyState>
        Custom blocks require an Enterprise plan. Contact your admin to enable them.
      </SettingsEmptyState>
    )
  }

  if (selected !== null && workspaceId) {
    return (
      <CustomBlockDetail
        key={selected}
        blockId={selected === 'new' ? null : selected}
        workspaceId={workspaceId}
        onBack={() => setSelected(null)}
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
      actions={[
        {
          text: 'Create block',
          icon: Plus,
          variant: 'primary',
          onSelect: () => setSelected('new'),
        },
      ]}
    >
      <SettingsSection label={`Blocks (${blocks.length})`}>
        {blocks.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            No custom blocks yet. Click "Create block" to publish a workflow as a block.
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
                  onClick={() => setSelected(cb.id)}
                  className='flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
                >
                  <div className='flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-3)]'>
                    <Icon className='size-[18px] object-contain' />
                  </div>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <div className='flex items-center gap-2'>
                      <span className='truncate text-[14px] text-[var(--text-body)]'>
                        {cb.name}
                      </span>
                      {!cb.enabled && (
                        <ChipTag variant='gray' className='flex-shrink-0'>
                          Disabled
                        </ChipTag>
                      )}
                    </div>
                    {cb.description && (
                      <span className='truncate text-[12px] text-[var(--text-muted)]'>
                        {cb.description}
                      </span>
                    )}
                  </div>
                  <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        )}
      </SettingsSection>
    </SettingsPanel>
  )
}
