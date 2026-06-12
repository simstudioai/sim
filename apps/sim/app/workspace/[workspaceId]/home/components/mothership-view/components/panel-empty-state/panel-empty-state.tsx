'use client'

import { useMemo, useState } from 'react'
import { ChipInput } from '@/components/emcn'
import { Search } from '@/components/emcn/icons'
import {
  MOTHERSHIP_PAGES,
  type MothershipPageId,
  type MothershipResourceType,
} from '@/lib/copilot/resources/types'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-pickers'
import { getResourceConfig } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useMothershipStageStore } from '@/stores/mothership-stage/store'

/** Kinds that read as noise in a quick-open list (no embedded view or too granular). */
const SEARCH_EXCLUDED_TYPES: readonly MothershipResourceType[] = [
  'folder',
  'filefolder',
  'integration',
  'task',
  'log',
]

const EMPTY_KEYS = new Set<string>()

const MAX_SEARCH_RESULTS = 20

const BROWSE_PAGES: MothershipResource[] = (
  Object.keys(MOTHERSHIP_PAGES) as MothershipPageId[]
).map((id) => ({ type: 'page', id, title: MOTHERSHIP_PAGES[id] }))

interface ResourceRowProps {
  resource: MothershipResource
  onSelect: (resource: MothershipResource) => void
}

function ResourceRow({ resource, onSelect }: ResourceRowProps) {
  const config = getResourceConfig(resource.type)
  return (
    <button
      type='button'
      onClick={() => onSelect(resource)}
      className='flex h-[32px] w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
    >
      {config.renderTabIcon(resource, 'size-[14px] shrink-0 text-[var(--text-icon)]')}
      <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>{resource.title}</span>
    </button>
  )
}

interface SectionProps {
  label: string
  children: React.ReactNode
}

function Section({ label, children }: SectionProps) {
  return (
    <div className='flex flex-col gap-1'>
      <p className='px-2 text-[var(--text-muted)] text-caption'>{label}</p>
      <div className='flex flex-col'>{children}</div>
    </div>
  )
}

interface PanelEmptyStateProps {
  workspaceId: string
}

/**
 * What the resource panel shows when nothing is staged: a quick-open surface.
 * Search spans every stageable workspace resource; below it sit the resources
 * most recently on stage and the workspace area pages, so the panel is useful
 * the moment it opens instead of sitting blank.
 */
export function PanelEmptyState({ workspaceId }: PanelEmptyStateProps) {
  const { openResource } = useMothershipResources()
  const storedRecents = useMothershipStageStore((s) => s.byWorkspace[workspaceId]?.recents)
  const recents = storedRecents ?? []
  const [query, setQuery] = useState('')
  const available = useAvailableResources(workspaceId, EMPTY_KEYS, SEARCH_EXCLUDED_TYPES)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return available
      .flatMap(({ type, items }) =>
        items
          .filter((item) => item.name.toLowerCase().includes(q))
          .map((item): MothershipResource => ({ type, id: item.id, title: item.name }))
      )
      .slice(0, MAX_SEARCH_RESULTS)
  }, [query, available])

  return (
    <div className='flex h-full flex-col items-center overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
      <div className='flex w-full max-w-[400px] flex-col pt-[16vh] pb-8'>
        <div className='animate-stream-fade-in'>
          <ChipInput
            icon={Search}
            placeholder='Search resources...'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='w-full'
          />
        </div>
        {/* Staggered after the search by 75ms. Fill-mode `both` (not an
            `opacity-0` base class) hides it during the delay yet leaves it
            visible if animations never run (reduced motion, hidden tab). */}
        <div className='mt-5 flex animate-stream-fade-in flex-col gap-5 [animation-delay:75ms] [animation-fill-mode:both]'>
          {results ? (
            results.length > 0 ? (
              <Section label='Results'>
                {results.map((resource) => (
                  <ResourceRow
                    key={`${resource.type}:${resource.id}`}
                    resource={resource}
                    onSelect={openResource}
                  />
                ))}
              </Section>
            ) : (
              <p className='px-2 text-[var(--text-muted)] text-sm'>No matching resources</p>
            )
          ) : (
            <>
              {recents.length > 0 && (
                <Section label='Recent'>
                  {recents.map((resource) => (
                    <ResourceRow
                      key={`${resource.type}:${resource.id}`}
                      resource={resource}
                      onSelect={openResource}
                    />
                  ))}
                </Section>
              )}
              <Section label='Browse'>
                {BROWSE_PAGES.map((resource) => (
                  <ResourceRow key={resource.id} resource={resource} onSelect={openResource} />
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
