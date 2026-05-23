'use client'

import type React from 'react'
import { useState } from 'react'
import {
  Briefcase,
  Building2,
  DollarSign,
  Globe,
  Link2,
  Mail,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'
import { Button, Input } from '@/components/emcn'
import { Search } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, WorkflowGroup } from '@/lib/table'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { generateColumnName } from '../../utils'
import { type WorkflowConfig, WorkflowSidebarBody } from '../workflow-sidebar'

/** A shared enrichment a user can drop onto a table as a workflow column. */
export interface EnrichmentTemplate {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * Curated catalog shown in the enrichments list. Stand-in data until a real
 * shared-workflow catalog exists — every card currently resolves to the first
 * workspace workflow as its template (see `Table`'s `onPickEnrichment`).
 */
const ENRICHMENT_TEMPLATES: EnrichmentTemplate[] = [
  {
    id: 'use-ai',
    name: 'Use AI',
    description: 'Run a custom AI prompt over each row.',
    icon: Sparkles,
  },
  { id: 'work-email', name: 'Work Email', description: "Find a person's work email.", icon: Mail },
  {
    id: 'company-domain',
    name: 'Company Domain',
    description: 'Find a domain address from a company name.',
    icon: Link2,
  },
  {
    id: 'website-traffic',
    name: 'Website Traffic (Monthly)',
    description: 'Get the monthly website traffic for a domain.',
    icon: TrendingUp,
  },
  {
    id: 'company-funding',
    name: 'Company Latest Funding',
    description: "Look up a company's latest funding details.",
    icon: DollarSign,
  },
  {
    id: 'website-techstack',
    name: 'Website Techstack',
    description: 'See what technologies a website uses.',
    icon: Globe,
  },
  {
    id: 'company-revenue',
    name: 'Company Revenue',
    description: "Find a company's revenue.",
    icon: Building2,
  },
  {
    id: 'company-jobs',
    name: 'Company Job Openings',
    description: "Look up a company's current job openings.",
    icon: Briefcase,
  },
]

interface EnrichmentsSidebarProps {
  open: boolean
  onClose: () => void
  /** Forwarded to the hosted workflow body — same props `WorkflowSidebar` takes. */
  allColumns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  workflows: WorkflowMetadata[] | undefined
  workspaceId: string
  tableId: string
  onColumnRename?: (oldName: string, newName: string) => void
}

/**
 * Right-edge panel for the enrichments flow. Hosts both the catalog list and
 * (once a card is picked) the workflow-config body in the *same* sliding panel,
 * so picking an enrichment swaps content in place rather than cross-sliding a
 * second panel over the list.
 */
export function EnrichmentsSidebar({ open, ...rest }: EnrichmentsSidebarProps) {
  return (
    <aside
      role='dialog'
      aria-label='Enrichments'
      className={cn(
        'absolute top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[400px] flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)] shadow-overlay transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {open && <EnrichmentsSidebarBody {...rest} />}
    </aside>
  )
}

function EnrichmentsSidebarBody({
  onClose,
  allColumns,
  workflowGroups,
  workflows,
  workspaceId,
  tableId,
  onColumnRename,
}: Omit<EnrichmentsSidebarProps, 'open'>) {
  const [selected, setSelected] = useState<EnrichmentTemplate | null>(null)
  const [query, setQuery] = useState('')

  // A card is picked — show the workflow-config body in this same panel. The
  // `key` remounts the body when the selection (or its resolved workflow)
  // changes so its form state re-seeds.
  if (selected) {
    const workflowId = workflows?.[0]?.id
    const config: WorkflowConfig = {
      mode: 'create',
      kind: 'enrichment',
      proposedName: generateColumnName(allColumns),
      workflowId,
      enrichmentName: selected.name,
    }
    return (
      <WorkflowSidebarBody
        key={`${selected.id}:${workflowId ?? ''}`}
        config={config}
        onClose={onClose}
        allColumns={allColumns}
        workflowGroups={workflowGroups}
        workflows={workflows}
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
        onBack={() => setSelected(null)}
      />
    )
  }

  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? ENRICHMENT_TEMPLATES.filter(
        (t) =>
          t.name.toLowerCase().includes(normalized) ||
          t.description.toLowerCase().includes(normalized)
      )
    : ENRICHMENT_TEMPLATES

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>Enrichments</h2>
        <Button
          variant='ghost'
          size='sm'
          onClick={onClose}
          className='!p-1 size-7 flex-none'
          aria-label='Close'
        >
          <X className='size-[14px]' />
        </Button>
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
            {filtered.map((template) => {
              const Icon = template.icon
              return (
                <li key={template.id}>
                  <Button
                    variant='ghost'
                    type='button'
                    onClick={() => setSelected(template)}
                    className='flex w-full items-start justify-start gap-2.5 rounded-md px-2 py-2 text-left hover-hover:bg-[var(--surface-3)]'
                  >
                    <Icon className='mt-0.5 size-[14px] flex-none text-[var(--text-icon)]' />
                    <span className='flex min-w-0 flex-col gap-0.5'>
                      <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                        {template.name}
                      </span>
                      <span className='truncate text-[var(--text-tertiary)] text-caption'>
                        {template.description}
                      </span>
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
