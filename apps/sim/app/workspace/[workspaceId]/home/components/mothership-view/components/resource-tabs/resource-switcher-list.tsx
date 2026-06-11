'use client'

import { X } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

export interface ResourceSwitcherItem {
  resource: MothershipResource
  name: string
  isActive: boolean
  /** Surfaced by the active chat — grouped under "From this chat". */
  isChatArtifact: boolean
  /** Changed while the tab wasn't focused. */
  isUpdated: boolean
}

interface ResourceSwitcherListProps {
  items: ResourceSwitcherItem[]
  onSelect: (id: string) => void
  onClose: (resource: MothershipResource) => void
}

function SwitcherRow({
  item,
  onSelect,
  onClose,
}: {
  item: ResourceSwitcherItem
  onSelect: (id: string) => void
  onClose: (resource: MothershipResource) => void
}) {
  const config = getResourceConfig(item.resource.type)
  return (
    <div
      className={cn(
        'group relative flex h-[30px] w-full items-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]',
        item.isActive && 'bg-[var(--surface-active)]'
      )}
    >
      <button
        type='button'
        onClick={() => onSelect(item.resource.id)}
        className='flex h-full min-w-0 flex-1 items-center gap-2 px-2 pr-[26px] text-left'
      >
        {config.renderTabIcon(item.resource, 'size-[14px] shrink-0')}
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>{item.name}</span>
      </button>
      {item.isUpdated && (
        <span
          aria-hidden='true'
          className='-translate-y-1/2 absolute top-1/2 right-[11px] size-[5px] rounded-full bg-[var(--brand-accent)] group-hover:opacity-0'
        />
      )}
      <button
        type='button'
        onClick={() => onClose(item.resource)}
        aria-label={`Close ${item.name}`}
        className='-translate-y-1/2 absolute top-1/2 right-[6px] flex items-center justify-center rounded-sm p-[2px] opacity-0 transition-opacity hover-hover:bg-[var(--surface-6)] group-hover:opacity-100'
      >
        <X strokeWidth={2.5} className='size-[10px] text-[var(--text-icon)]' />
      </button>
    </div>
  )
}

/**
 * The resource switcher dropdown's contents: every open tab, grouped by
 * provenance ("From this chat" vs the rest) when the active chat has surfaced
 * any of them. Rows select on click and expose a hover close control.
 */
export function ResourceSwitcherList({ items, onSelect, onClose }: ResourceSwitcherListProps) {
  const chatItems = items.filter((item) => item.isChatArtifact)
  const otherItems = items.filter((item) => !item.isChatArtifact)
  const showSections = chatItems.length > 0 && otherItems.length > 0

  return (
    <div className='flex flex-col px-2 py-2'>
      {showSections && (
        <p className='px-2 py-1 font-medium text-[var(--text-muted)] text-caption'>
          From this chat
        </p>
      )}
      {(showSections ? chatItems : items).map((item) => (
        <SwitcherRow key={item.resource.id} item={item} onSelect={onSelect} onClose={onClose} />
      ))}
      {showSections && (
        <>
          <p className='mt-1.5 px-2 py-1 font-medium text-[var(--text-muted)] text-caption'>
            Other open tabs
          </p>
          {otherItems.map((item) => (
            <SwitcherRow key={item.resource.id} item={item} onSelect={onSelect} onClose={onClose} />
          ))}
        </>
      )}
    </div>
  )
}
