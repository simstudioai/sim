'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/emcn'
import { blockTypeToIconMap } from '@/app/(landing)/integrations/data/icon-mapping'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationCard } from './integration-card'

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  analytics: 'Analytics',
  automation: 'Automation',
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
  media: 'Media',
  productivity: 'Productivity',
  'sales-intelligence': 'Sales Intelligence',
  search: 'Search',
  security: 'Security',
  social: 'Social',
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
      if (i.integrationType) {
        counts.set(i.integrationType, (counts.get(i.integrationType) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key)
  }, [integrations])

  const filtered = useMemo(() => {
    let results = integrations

    if (activeCategory) {
      results = results.filter((i) => i.integrationType === activeCategory)
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
      <div className='mb-6 flex flex-col gap-4 sm:flex-row sm:items-center'>
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

      <div className='mb-8 flex flex-wrap gap-2'>
        <button
          type='button'
          onClick={() => setActiveCategory(null)}
          className={`rounded-md border px-3 py-1 text-[12px] transition-colors ${
            activeCategory === null
              ? 'border-[#555] bg-[#333] text-[var(--landing-text)]'
              : 'border-[var(--landing-border)] bg-transparent text-[var(--landing-text-muted)] hover:border-[var(--landing-border-strong)] hover:text-[var(--landing-text)]'
          }`}
        >
          All
        </button>
        {availableCategories.map((cat) => (
          <button
            key={cat}
            type='button'
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`rounded-md border px-3 py-1 text-[12px] transition-colors ${
              activeCategory === cat
                ? 'border-[#555] bg-[#333] text-[var(--landing-text)]'
                : 'border-[var(--landing-border)] bg-transparent text-[var(--landing-text-muted)] hover:border-[var(--landing-border-strong)] hover:text-[var(--landing-text)]'
            }`}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className='py-12 text-center text-[#555] text-[15px]'>
          No integrations found
          {query ? <> for &ldquo;{query}&rdquo;</> : null}
          {activeCategory ? <> in {CATEGORY_LABELS[activeCategory] || activeCategory}</> : null}
        </p>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'>
          {filtered.map((integration) => (
            <IntegrationCard
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
