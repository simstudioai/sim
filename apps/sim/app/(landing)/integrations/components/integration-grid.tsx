'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/emcn'
import { blockTypeToIconMap } from '@/app/(landing)/integrations/data/icon-mapping'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationCard } from './integration-card'

interface IntegrationGridProps {
  integrations: Integration[]
}

export function IntegrationGrid({ integrations }: IntegrationGridProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return integrations
    return integrations.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.operations.some(
          (op) => op.name.toLowerCase().includes(q) || op.description.toLowerCase().includes(q)
        ) ||
        i.triggers.some((t) => t.name.toLowerCase().includes(q))
    )
  }, [integrations, query])

  return (
    <div>
      <div className='relative mb-8 max-w-[480px]'>
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

      {filtered.length === 0 ? (
        <p className='py-12 text-center text-[#555] text-[15px]'>
          No integrations found for &ldquo;{query}&rdquo;
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
