'use client'

import { useMemo, useState } from 'react'
import { ChipInput, Search } from '@sim/emcn'
import Link from 'next/link'
import { ChevronArrow } from '@/app/(landing)/components/chevron-arrow'
import { ProviderIcon } from '@/app/(landing)/models/components/model-primitives'
import {
  type CatalogModel,
  type CatalogProvider,
  formatPrice,
  formatTokenCount,
  MODEL_PROVIDERS_WITH_CATALOGS,
  MODEL_PROVIDERS_WITH_DYNAMIC_CATALOGS,
} from '@/app/(landing)/models/utils'

const PROVIDER_OPTIONS = MODEL_PROVIDERS_WITH_CATALOGS.map((provider) => ({
  id: provider.id,
  name: provider.name,
  count: provider.modelCount,
}))

export function ModelDirectory() {
  const [query, setQuery] = useState('')
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)

  const normalizedQuery = query.trim().toLowerCase()

  const { filteredProviders, filteredDynamicProviders } = useMemo(() => {
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

    return {
      filteredProviders,
      filteredDynamicProviders,
    }
  }, [activeProviderId, normalizedQuery])

  const hasResults = filteredProviders.length > 0 || filteredDynamicProviders.length > 0

  return (
    <div>
      <div className='mb-6 flex flex-col gap-4 px-6 sm:flex-row sm:items-center'>
        <div className='max-w-[480px] flex-1'>
          <ChipInput
            icon={Search}
            type='search'
            placeholder='Search models, providers, or capabilities…'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label='Search AI models'
          />
        </div>
      </div>

      <div className='mb-6 flex flex-wrap gap-2 px-6'>
        <button
          type='button'
          onClick={() => setActiveProviderId(null)}
          className={`rounded-[5px] border px-[9px] py-0.5 text-small transition-colors ${
            activeProviderId === null
              ? 'border-[var(--border-1)] bg-[var(--surface-active)] text-[var(--text-primary)]'
              : 'border-[var(--border-1)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
          }`}
        >
          All
        </button>
        {PROVIDER_OPTIONS.map((provider) => (
          <button
            key={provider.id}
            type='button'
            onClick={() =>
              setActiveProviderId(activeProviderId === provider.id ? null : provider.id)
            }
            className={`rounded-[5px] border px-[9px] py-0.5 text-small transition-colors ${
              activeProviderId === provider.id
                ? 'border-[var(--border-1)] bg-[var(--surface-active)] text-[var(--text-primary)]'
                : 'border-[var(--border-1)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {provider.name}
          </button>
        ))}
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      {!hasResults ? (
        <div className='px-6 py-12 text-center'>
          <h3 className='text-[18px] text-[var(--text-primary)]'>No matches found</h3>
          <p className='mt-2 text-[var(--text-muted)] text-sm leading-[150%]'>
            Try a provider name like OpenAI or Anthropic, or search for capabilities like
            &nbsp;structured outputs, reasoning, or deep research.
          </p>
        </div>
      ) : (
        <div>
          {filteredProviders.map((provider, index) => (
            <section key={provider.id} aria-labelledby={`${provider.id}-heading`}>
              {index > 0 && <div className='h-px w-full bg-[var(--border)]' />}

              <Link
                href={provider.href}
                className='group/link flex items-center gap-3 px-6 py-4 transition-colors hover:bg-[var(--surface-hover)]'
              >
                <ProviderIcon
                  provider={provider}
                  className='size-8 rounded-xl'
                  iconClassName='size-4'
                />
                <div className='min-w-0 flex-1'>
                  <h3
                    id={`${provider.id}-heading`}
                    className='text-[14px] text-[var(--text-primary)] leading-snug tracking-[-0.02em]'
                  >
                    {provider.name}
                  </h3>
                  <p className='line-clamp-1 hidden text-[12px] text-[var(--text-muted)] leading-[150%] sm:block'>
                    {provider.modelCount} models &middot; {provider.description}
                  </p>
                </div>
                <ChevronArrow />
              </Link>

              {provider.models.map((model) => (
                <ModelRow key={model.id} provider={provider} model={model} />
              ))}
            </section>
          ))}

          {filteredDynamicProviders.length > 0 && (
            <section aria-labelledby='dynamic-catalogs-heading'>
              <div className='h-px w-full bg-[var(--border)]' />

              <div className='px-6 pt-8 pb-6'>
                <h3
                  id='dynamic-catalogs-heading'
                  className='text-[18px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[20px]'
                >
                  Dynamic model catalogs
                </h3>
                <p className='mt-2 text-[var(--text-muted)] text-sm leading-[150%]'>
                  These providers load their model lists dynamically at runtime.
                </p>
              </div>

              <div className='h-px w-full bg-[var(--border)]' />

              <nav aria-label='Dynamic catalog providers' className='flex flex-col lg:flex-row'>
                {filteredDynamicProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className='flex flex-1 items-center gap-3 border-[var(--border)] border-t px-6 py-4 first:border-t-0 lg:border-t-0 lg:border-l lg:first:border-l-0'
                  >
                    <ProviderIcon
                      provider={provider}
                      className='size-8 rounded-xl'
                      iconClassName='size-4'
                    />
                    <div className='min-w-0 flex-1'>
                      <h4 className='text-[14px] text-[var(--text-primary)] leading-snug'>
                        {provider.name}
                      </h4>
                      <p className='line-clamp-1 text-[12px] text-[var(--text-muted)] leading-[150%]'>
                        {provider.description}
                      </p>
                    </div>
                  </div>
                ))}
              </nav>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function ModelRow({ provider, model }: { provider: CatalogProvider; model: CatalogModel }) {
  return (
    <>
      <div className='h-px w-full bg-[var(--border)]' />
      <Link
        href={model.href}
        className='group/link flex items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--surface-hover)]'
      >
        <ProviderIcon
          provider={provider}
          className='size-8 shrink-0 rounded-xl'
          iconClassName='size-4'
        />

        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <h4 className='text-[14px] text-[var(--text-primary)] leading-snug tracking-[-0.02em]'>
            {model.displayName}
          </h4>
          <p className='line-clamp-1 hidden text-[12px] text-[var(--text-muted)] leading-[150%] sm:block'>
            {model.id} &middot; Input {formatPrice(model.pricing.input)}/1M &middot; Output{' '}
            {formatPrice(model.pricing.output)}/1M
            {model.contextWindow ? ` · ${formatTokenCount(model.contextWindow)} context` : ''}
          </p>
        </div>

        <ChevronArrow />
      </Link>
    </>
  )
}
