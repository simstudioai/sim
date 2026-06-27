'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ChipInput } from '@/components/emcn'
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
  const t = useTranslations('auto')
  return (
    <aside
      role='dialog'
      aria-label={t('enrichments')}
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
  const t = useTranslations('auto')
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
        <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
          <h2 className='font-medium text-[var(--text-primary)] text-small'>{t('enrichment')}</h2>
          <Button
            variant='ghost'
            size='sm'
            onClick={onClose}
            className='!p-1 size-7 flex-none'
            aria-label={t('close')}
          >
            <X className='size-[14px]' />
          </Button>
        </div>
        <div className='flex flex-1 items-center justify-center px-6 text-center'>
          <p className='text-[var(--text-tertiary)] text-small'>
            {t('this_enrichment')}
            {editGroup.enrichmentId}
            {t('is_no_longer_available_delete_the')}
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
      <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>{t('enrichments')}</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          className='!p-1 size-7 flex-none'
          aria-label={t('close')}
        >
          <X className='size-[14px]' />
        </Button>
      </div>

      <div className='px-2 pt-3'>
        <ChipInput
          icon={Search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          spellCheck={false}
          autoComplete='off'
        />
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 py-3 [overflow-anchor:none]'>
        {filtered.length === 0 ? (
          <p className='px-1 pt-2 text-[var(--text-tertiary)] text-small'>
            {t('no_enrichments_found')}
          </p>
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
