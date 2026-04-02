'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/emcn'
import { SearchIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  CapabilityTags,
  DetailItem,
  ModelCard,
  ProviderIcon,
  StatCard,
} from '@/app/(landing)/models/components/model-primitives'
import {
  type CatalogProvider,
  MODEL_PROVIDERS_WITH_CATALOGS,
  MODEL_PROVIDERS_WITH_DYNAMIC_CATALOGS,
  TOTAL_MODELS,
} from '@/app/(landing)/models/utils'

export function ModelDirectory() {
  const [query, setQuery] = useState('')
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)

  const providerOptions = useMemo(
    () =>
      MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
        id: provider.id,
        name: provider.name,
        count: provider.modelCount,
      })),
    []
  )

  const normalizedQuery = query.trim().toLowerCase()

  const { filteredProviders, filteredDynamicProviders, visibleModelCount } = useMemo(() => {
    const filteredProviders = MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => {
      const providerMatchesSearch =
        normalizedQuery.length > 0 && provider.searchText.includes(normalizedQuery)
      const providerMatchesFilter = !activeProviderId || provider.id === activeProviderId

      if (!providerMatchesFilter) {
        return null
      }

      const models =
        normalizedQuery.length === 0
          ? provider.models
          : provider.models.filter(
              (model) =>
                model.searchText.includes(normalizedQuery) ||
                (providerMatchesSearch && normalizedQuery.length > 0)
            )

      if (!providerMatchesSearch && models.length === 0) {
        return null
      }

      return {
        ...provider,
        models: providerMatchesSearch && normalizedQuery.length > 0 ? provider.models : models,
      }
    }).filter((provider): provider is CatalogProvider => provider !== null)

    const filteredDynamicProviders = MODEL_PROVIDERS_WITH_DYNAMIC_CATALOGS.filter((provider) => {
      const providerMatchesFilter = !activeProviderId || provider.id === activeProviderId
      if (!providerMatchesFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return provider.searchText.includes(normalizedQuery)
    })

    const visibleModelCount = filteredProviders.reduce(
      (count, provider) => count + provider.models.length,
      0
    )

    return {
      filteredProviders,
      filteredDynamicProviders,
      visibleModelCount,
    }
  }, [activeProviderId, normalizedQuery])

  const hasResults = filteredProviders.length > 0 || filteredDynamicProviders.length > 0

  return (
    <div>
      <div className='mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
        <div className='relative max-w-[560px] flex-1'>
          <SearchIcon
            aria-hidden='true'
            className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-[var(--landing-text-muted)]'
          />
          <Input
            type='search'
            placeholder='Search models, providers, capabilities, or pricing details'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='h-11 border-[var(--landing-border)] bg-[var(--landing-bg-card)] pl-10 text-[var(--landing-text)] placeholder:text-[var(--landing-text-muted)]'
            aria-label='Search AI models'
          />
        </div>

        <p className='text-[13px] text-[var(--landing-text-muted)] leading-relaxed'>
          Showing {visibleModelCount.toLocaleString('en-US')} of{' '}
          {TOTAL_MODELS.toLocaleString('en-US')} models
          {activeProviderId ? ' in one provider' : ''}.
        </p>
      </div>

      <div className='mb-10 flex flex-wrap gap-2'>
        <FilterButton
          isActive={activeProviderId === null}
          onClick={() => setActiveProviderId(null)}
          label={`All providers (${MODEL_PROVIDERS_WITH_CATALOGS.length})`}
        />
        {providerOptions.map((provider) => (
          <FilterButton
            key={provider.id}
            isActive={activeProviderId === provider.id}
            onClick={() =>
              setActiveProviderId(activeProviderId === provider.id ? null : provider.id)
            }
            label={`${provider.name} (${provider.count})`}
          />
        ))}
      </div>

      {!hasResults ? (
        <div className='rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] px-6 py-12 text-center'>
          <h3 className='font-[500] text-[18px] text-[var(--landing-text)]'>No matches found</h3>
          <p className='mt-2 text-[14px] text-[var(--landing-text-muted)] leading-relaxed'>
            Try a provider name like OpenAI or Anthropic, or search for capabilities like
            &nbsp;structured outputs, reasoning, or deep research.
          </p>
        </div>
      ) : (
        <div className='space-y-10'>
          {filteredProviders.map((provider) => (
            <section
              key={provider.id}
              aria-labelledby={`${provider.id}-heading`}
              className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
            >
              <div className='mb-6 flex flex-col gap-5 border-[var(--landing-border)] border-b pb-6 lg:flex-row lg:items-start lg:justify-between'>
                <div className='min-w-0'>
                  <div className='mb-3 flex items-center gap-3'>
                    <ProviderIcon provider={provider} />
                    <div>
                      <p className='text-[12px] text-[var(--landing-text-muted)]'>Provider</p>
                      <h2
                        id={`${provider.id}-heading`}
                        className='font-[500] text-[24px] text-[var(--landing-text)]'
                      >
                        {provider.name}
                      </h2>
                    </div>
                  </div>

                  <p className='max-w-[720px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
                    {provider.description}
                  </p>
                  <Link
                    href={provider.href}
                    className='mt-3 inline-flex text-[#555] text-[13px] transition-colors hover:text-[var(--landing-text-muted)]'
                  >
                    View provider page →
                  </Link>
                </div>

                <div className='grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3'>
                  <StatCard label='Models' value={provider.models.length.toString()} />
                  <StatCard
                    label='Default'
                    value={provider.defaultModelDisplayName || 'Dynamic'}
                    compact
                  />
                  <StatCard
                    label='Context info'
                    value={provider.contextInformationAvailable ? 'Tracked' : 'Limited'}
                    compact
                  />
                </div>
              </div>

              <div className='mb-6'>
                <CapabilityTags tags={provider.providerCapabilityTags} />
              </div>

              <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
                {provider.models.map((model) => (
                  <ModelCard key={model.id} provider={provider} model={model} />
                ))}
              </div>
            </section>
          ))}

          {filteredDynamicProviders.length > 0 && (
            <section
              aria-labelledby='dynamic-catalogs-heading'
              className='rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-6 sm:p-8'
            >
              <div className='mb-6'>
                <h2
                  id='dynamic-catalogs-heading'
                  className='font-[500] text-[24px] text-[var(--landing-text)]'
                >
                  Dynamic model catalogs
                </h2>
                <p className='mt-2 max-w-[760px] text-[15px] text-[var(--landing-text-muted)] leading-relaxed'>
                  These providers are supported by Sim, but their model lists are loaded dynamically
                  at runtime rather than hard-coded into the public catalog.
                </p>
              </div>

              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
                {filteredDynamicProviders.map((provider) => (
                  <article
                    key={provider.id}
                    className='rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-bg-elevated)] p-5'
                  >
                    <div className='mb-4 flex items-center gap-3'>
                      <ProviderIcon provider={provider} />
                      <div className='min-w-0'>
                        <h3 className='font-[500] text-[16px] text-[var(--landing-text)]'>
                          {provider.name}
                        </h3>
                        <p className='text-[12px] text-[var(--landing-text-muted)]'>
                          {provider.id}
                        </p>
                      </div>
                    </div>

                    <p className='text-[13px] text-[var(--landing-text-muted)] leading-relaxed'>
                      {provider.description}
                    </p>

                    <div className='mt-4 space-y-3 text-[13px]'>
                      <DetailItem
                        label='Default'
                        value={provider.defaultModelDisplayName || 'Selected at runtime'}
                      />
                      <DetailItem label='Catalog source' value='Loaded dynamically inside Sim' />
                    </div>

                    <div className='mt-4'>
                      <CapabilityTags tags={provider.providerCapabilityTags} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function FilterButton({
  isActive,
  onClick,
  label,
}: {
  isActive: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12px] transition-colors',
        isActive
          ? 'border-[#555] bg-[#333] text-[var(--landing-text)]'
          : 'border-[var(--landing-border)] bg-transparent text-[var(--landing-text-muted)] hover:border-[var(--landing-border-strong)] hover:text-[var(--landing-text)]'
      )}
    >
      {label}
    </button>
  )
}
