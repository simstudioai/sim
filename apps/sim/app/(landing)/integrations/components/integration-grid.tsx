'use client'

import { useState } from 'react'
import { ChipInput, Search } from '@sim/emcn'
import { blockTypeToIconMap, formatIntegrationType, type Integration } from '@/lib/integrations'
import { IntegrationRow } from '@/app/(landing)/integrations/components/integration-card'

const PILL_BASE =
  'rounded-[5px] border border-[var(--landing-border-strong)] px-[9px] py-0.5 text-[13.5px] text-[var(--landing-text)] transition-colors' as const
const PILL_ACTIVE = 'bg-[var(--landing-bg-elevated)]' as const
const PILL_INACTIVE = 'hover:bg-[var(--landing-bg-elevated)]' as const

interface IntegrationGridProps {
  integrations: readonly Integration[]
}

export function IntegrationGrid({ integrations }: IntegrationGridProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const counts = new Map<string, number>()
  for (const i of integrations) {
    if (i.integrationType) {
      counts.set(i.integrationType, (counts.get(i.integrationType) || 0) + 1)
    }
  }
  const availableCategories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)

  const q = query.trim().toLowerCase()
  const filtered = integrations.filter((i) => {
    if (activeCategory && i.integrationType !== activeCategory) return false
    if (!q) return true
    return (
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.operations.some(
        (op) => op.name.toLowerCase().includes(q) || op.description.toLowerCase().includes(q)
      ) ||
      i.triggers.some((t) => t.name.toLowerCase().includes(q))
    )
  })

  return (
    <div>
      <div className='mb-6 flex flex-col gap-4 px-6 sm:flex-row sm:items-center'>
        <div className='max-w-[480px] flex-1'>
          <ChipInput
            icon={Search}
            type='search'
            placeholder='Search integrations, tools, or triggers…'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label='Search integrations'
          />
        </div>
      </div>

      <div className='mb-6 flex flex-wrap gap-2 px-6'>
        <button
          type='button'
          onClick={() => setActiveCategory(null)}
          className={`${PILL_BASE} ${activeCategory === null ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          All
        </button>
        {availableCategories.map((cat) => (
          <button
            key={cat}
            type='button'
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`${PILL_BASE} ${activeCategory === cat ? PILL_ACTIVE : PILL_INACTIVE}`}
          >
            {formatIntegrationType(cat)}
          </button>
        ))}
      </div>

      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

      {filtered.length === 0 ? (
        <p className='py-12 text-center text-[15px] text-[var(--landing-text-subtle)]'>
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
