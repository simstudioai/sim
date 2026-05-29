'use client'

import { useState } from 'react'
import { Input } from '@/components/emcn'
import { Search, X } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, WorkflowGroup } from '@/lib/table'
import { ALL_ENRICHMENTS } from '@/enrichments'
import { getEnrichment } from '@/enrichments/registry'
import type { EnrichmentConfig as EnrichmentDef } from '@/enrichments/types'
import { EnrichmentConfig } from './enrichment-config'

interface EnrichmentsSidebarProps {
  open: boolean
  onClose: () => void
  allColumns: ColumnDefinition[]
  workspaceId: string
  tableId: string
  /** When set, the sidebar opens straight into this enrichment group's config
   *  in edit mode (skips the catalog list). */
  editGroup?: WorkflowGroup
}

/**
 * Right-edge panel for the enrichments flow. Lists the code-defined enrichment
 * registry and, once one is picked, swaps in its config panel in the *same*
 * sliding panel (input mapping + outputs), which creates an enrichment column.
 */
export function EnrichmentsSidebar({ open, ...rest }: EnrichmentsSidebarProps) {
  return (
    <aside
      role='dialog'
      aria-label='Enrichments'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] transition-transform duration-200 ease-out',
        open ? 'translate-x-0 shadow-overlay' : 'translate-x-full'
      )}
    >
      {open && <EnrichmentsSidebarBody {...rest} />}
    </aside>
  )
}

function EnrichmentsSidebarBody({
  onClose,
  allColumns,
  workspaceId,
  tableId,
  editGroup,
}: Omit<EnrichmentsSidebarProps, 'open'>) {
  const [selected, setSelected] = useState<EnrichmentDef | null>(null)
  const [query, setQuery] = useState('')

  // Edit mode: open the picked enrichment's config directly, pre-filled from the
  // existing group. No catalog list / back-to-list step.
  const editEnrichment = editGroup ? getEnrichment(editGroup.enrichmentId) : undefined
  if (editGroup && editEnrichment) {
    return (
      <EnrichmentConfig
        enrichment={editEnrichment}
        existingGroup={editGroup}
        allColumns={allColumns}
        workspaceId={workspaceId}
        tableId={tableId}
        onBack={onClose}
        onClose={onClose}
      />
    )
  }
  // Editing a group whose enrichment was removed from the registry — surface it
  // rather than silently dropping into the "new enrichment" catalog.
  if (editGroup && !editEnrichment) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
          <h2 className='font-medium text-[var(--text-primary)] text-small'>Enrichment</h2>
          <button
            type='button'
            onClick={onClose}
            className='flex size-7 flex-none items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
            aria-label='Close'
          >
            <X className='size-[14px]' />
          </button>
        </div>
        <div className='flex flex-1 items-center justify-center px-6 text-center'>
          <p className='text-[var(--text-tertiary)] text-small'>
            This enrichment ("{editGroup.enrichmentId}") is no longer available. Delete the column
            and add a current enrichment.
          </p>
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <EnrichmentConfig
        enrichment={selected}
        allColumns={allColumns}
        workspaceId={workspaceId}
        tableId={tableId}
        onBack={() => setSelected(null)}
        onClose={onClose}
      />
    )
  }

  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? ALL_ENRICHMENTS.filter(
        (e) =>
          e.name.toLowerCase().includes(normalized) ||
          e.description.toLowerCase().includes(normalized)
      )
    : ALL_ENRICHMENTS

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>Enrichments</h2>
        <button
          type='button'
          onClick={onClose}
          className='flex size-7 flex-none items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
          aria-label='Close'
        >
          <X className='size-[14px]' />
        </button>
      </div>

      <div className='px-2 pt-3'>
        <div className='relative'>
          <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-[14px] text-[var(--text-muted)]' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search'
            spellCheck={false}
            autoComplete='off'
            className='pl-7'
          />
        </div>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 [overflow-anchor:none]'>
        {filtered.length === 0 ? (
          <p className='px-1 pt-2 text-[var(--text-tertiary)] text-small'>No enrichments found.</p>
        ) : (
          <ul className='flex flex-col'>
            {filtered.map((enrichment) => {
              const Icon = enrichment.icon
              return (
                <li key={enrichment.id}>
                  <button
                    type='button'
                    onClick={() => setSelected(enrichment)}
                    className='flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-hover)]'
                  >
                    <Icon className='mt-0.5 size-[14px] flex-none text-[var(--text-icon)]' />
                    <span className='flex min-w-0 flex-col gap-0.5'>
                      <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                        {enrichment.name}
                      </span>
                      <span className='whitespace-normal break-words text-[var(--text-tertiary)] text-caption'>
                        {enrichment.description}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
