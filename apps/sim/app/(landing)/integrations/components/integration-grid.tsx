'use client'

import { useMemo } from 'react'
import { ChipInput, Search } from '@sim/emcn'
import { debounce, useQueryStates } from 'nuqs'
import {
  blockTypeToIconMap,
  formatIntegrationType,
  type IntegrationSummary,
} from '@/lib/integrations'
import { IntegrationRow } from '@/app/(landing)/integrations/components/integration-card'
import {
  integrationsParsers,
  integrationsUrlKeys,
} from '@/app/(landing)/integrations/search-params'

/** Debounce window for writing the search term to the URL (filtering is instant). */
const SEARCH_DEBOUNCE_MS = 300

const PILL_BASE =
  'rounded-[5px] border border-[var(--border-1)] px-[9px] py-0.5 text-small text-[var(--text-primary)] transition-colors' as const
const PILL_ACTIVE = 'bg-[var(--surface-active)]' as const
const PILL_INACTIVE = 'hover:bg-[var(--surface-hover)]' as const

interface IntegrationGridProps {
  integrations: readonly IntegrationSummary[]
}

export function IntegrationGrid({ integrations }: IntegrationGridProps) {
  const [{ q: query, category }, setParams] = useQueryStates(
    integrationsParsers,
    integrationsUrlKeys
  )
  const activeCategory = category || null

  /** Category facets, derived once from the (stable) integration list. */
  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of integrations) {
      if (i.integrationType) {
        counts.set(i.integrationType, (counts.get(i.integrationType) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key)
  }, [integrations])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      integrations.filter((i) => {
        if (activeCategory && i.integrationType !== activeCategory) return false
        if (!q) return true
        return i.searchFields.some((field) => field.includes(q))
      }),
    [integrations, q, activeCategory]
  )

  return (
    <div>
      <div className='mb-6 flex flex-col gap-4 px-6 sm:flex-row sm:items-center'>
        <div className='max-w-[480px] flex-1'>
          <ChipInput
            icon={Search}
            type='search'
            placeholder='Search integrations, tools, or triggers…'
            value={query}
            onChange={(e) =>
              setParams({ q: e.target.value }, { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) })
            }
            aria-label='Search integrations'
          />
        </div>
      </div>

      <div className='mb-6 flex flex-wrap gap-2 px-6'>
        <button
          type='button'
          onClick={() => setParams({ category: '' })}
          className={`${PILL_BASE} ${activeCategory === null ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          All
        </button>
        {availableCategories.map((cat) => (
          <button
            key={cat}
            type='button'
            onClick={() => setParams({ category: activeCategory === cat ? '' : cat })}
            className={`${PILL_BASE} ${activeCategory === cat ? PILL_ACTIVE : PILL_INACTIVE}`}
          >
            {formatIntegrationType(cat)}
          </button>
        ))}
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      {filtered.length === 0 ? (
        <p className='py-12 text-center text-[15px] text-[var(--text-muted)]'>
          No integrations found
          {query ? <> for &ldquo;{query}&rdquo;</> : null}
          {activeCategory ? <> in {formatIntegrationType(activeCategory)}</> : null}
        </p>
      ) : (
        <div>
          {filtered.map((integration) => (
            <IntegrationRow
              key={integration.type}
              integration={integration}
              IconComponent={blockTypeToIconMap[integration.type]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
