'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/emcn'
import { blockTypeToIconMap } from '@/app/(landing)/integrations/data/icon-mapping'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationRow } from './integration-card'

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  analytics: 'Analytics',
  communication: 'Communication',
  crm: 'CRM',
  'customer-support': 'Customer Support',
  databases: 'Databases',
  design: 'Design',
  'developer-tools': 'Developer Tools',
  documents: 'Documents',
  ecommerce: 'E-commerce',
  email: 'Email',
  'file-storage': 'File Storage',
  hr: 'HR',
  productivity: 'Productivity',
  sales: 'Sales',
  search: 'Search',
  security: 'Security',
  other: 'Other',
} as const

interface IntegrationGridProps {
  integrations: Integration[]
}

export function IntegrationGrid({ integrations }: IntegrationGridProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of integrations) {
      if (i.integrationTypes) {
        for (const t of i.integrationTypes) {
          counts.set(t, (counts.get(t) || 0) + 1)
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key)
  }, [integrations])

  const filtered = useMemo(() => {
    let results = integrations

    if (activeCategory) {
      results = results.filter((i) => i.integrationTypes?.includes(activeCategory))
    }

    const q = query.trim().toLowerCase()
    if (q) {
      results = results.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.operations.some(
            (op) => op.name.toLowerCase().includes(q) || op.description.toLowerCase().includes(q)
          ) ||
          i.triggers.some((t) => t.name.toLowerCase().includes(q))
      )
    }

    return results
  }, [integrations, query, activeCategory])

  return (
    <div>
      <div className='mb-6 flex flex-col gap-4 px-6 sm:flex-row sm:items-center'>
        <div className='relative max-w-[480px] flex-1'>
          <svg
            aria-hidden='true'
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-[#555]'
            fill='none'
            stroke='currentColor'
            strokeWidth={2}
            viewBox='0 0 24 24'
          >
            <circle cx={11} cy={11} r={8} />
            <path d='m21 21-4.35-4.35' />
          </svg>
          <Input
            type='search'
            placeholder='Search integrations, tools, or triggers…'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='pl-9'
            aria-label='Search integrations'
          />
        </div>
      </div>

      <div className='mb-6 flex flex-wrap gap-2 px-6'>
        <button
          type='button'
          onClick={() => setActiveCategory(null)}
          className={`rounded-[5px] border px-[9px] py-0.5 text-[13.5px] transition-colors ${
            activeCategory === null
              ? 'border-[var(--landing-border-strong)] bg-[var(--landing-bg-elevated)] text-[var(--landing-text)]'
              : 'border-[var(--landing-border-strong)] text-[var(--landing-text)] hover:bg-[var(--landing-bg-elevated)]'
          }`}
        >
          All
        </button>
        {availableCategories.map((cat) => (
          <button
            key={cat}
            type='button'
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`rounded-[5px] border px-[9px] py-0.5 text-[13.5px] transition-colors ${
              activeCategory === cat
                ? 'border-[var(--landing-border-strong)] bg-[var(--landing-bg-elevated)] text-[var(--landing-text)]'
                : 'border-[var(--landing-border-strong)] text-[var(--landing-text)] hover:bg-[var(--landing-bg-elevated)]'
            }`}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

      {filtered.length === 0 ? (
        <p className='py-12 text-center text-[15px] text-[var(--landing-text-subtle)]'>
          No integrations found
          {query ? <> for &ldquo;{query}&rdquo;</> : null}
          {activeCategory ? <> in {CATEGORY_LABELS[activeCategory] || activeCategory}</> : null}
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
