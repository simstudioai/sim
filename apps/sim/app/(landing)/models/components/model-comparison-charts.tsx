'use client'

import type { ComponentType } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { getProviderColor } from '@/app/(landing)/models/components/consts'
import type { CatalogModel } from '@/app/(landing)/models/utils'
import {
  formatPrice,
  formatTokenCount,
  MODEL_CATALOG_PROVIDERS,
} from '@/app/(landing)/models/utils'

/** Providers that host other providers' models — deprioritized to avoid duplicates. */
const RESELLER_PROVIDERS = new Set(
  MODEL_CATALOG_PROVIDERS.filter((p) => p.isReseller).map((p) => p.id)
)

const PROVIDER_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = (() => {
  const map: Record<string, ComponentType<{ className?: string }>> = {}
  for (const provider of MODEL_CATALOG_PROVIDERS) {
    if (provider.icon) {
      map[provider.id] = provider.icon
    }
  }
  return map
})()

function selectComparisonModels(models: CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>()
  const result: CatalogModel[] = []

  const sorted = [...models].sort((a, b) => {
    const score = (m: CatalogModel) => {
      const reseller = RESELLER_PROVIDERS.has(m.providerId) ? -50 : 0
      const reasoning = m.capabilities.reasoningEffort || m.capabilities.thinking ? 10 : 0
      const context = (m.contextWindow ?? 0) / 100000
      return reseller + reasoning + context
    }
    return score(b) - score(a)
  })

  for (const model of sorted) {
    if (result.length >= 10) break
    const nameKey = model.displayName.toLowerCase()
    if (seen.has(nameKey)) continue
    seen.add(nameKey)
    result.push(model)
  }

  return result
}

interface ModelLabelProps {
  model: CatalogModel
}

function ModelLabel({ model }: ModelLabelProps) {
  const Icon = PROVIDER_ICON_MAP[model.providerId]

  return (
    <div className='flex w-[140px] shrink-0 items-center justify-end gap-1.5 sm:w-[180px]'>
      {Icon && <Icon className='h-3.5 w-3.5 shrink-0' />}
      <span className='truncate font-medium text-[13px] text-[var(--landing-text)] leading-none tracking-[-0.01em]'>
        {model.displayName}
      </span>
    </div>
  )
}

interface ChartProps {
  models: CatalogModel[]
}

function StackedCostChart({ models }: ChartProps) {
  const data = useMemo(() => {
    const entries = models
      .map((model) => ({
        model,
        input: model.pricing.input,
        output: model.pricing.output,
        total: model.pricing.input + model.pricing.output,
      }))
      .filter((e) => e.total > 0)
      .sort((a, b) => a.total - b.total)

    const maxTotal = entries.length > 0 ? Math.max(...entries.map((e) => e.total)) : 0
    return { entries, maxTotal }
  }, [models])

  if (data.entries.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'>
          Cost
        </h3>
        <span className='font-[430] font-season text-[var(--landing-text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          Per 1M tokens
        </span>
      </div>

      <div className='flex flex-col gap-1.5'>
        {data.entries.map(({ model, input, output, total }) => {
          const totalPct = data.maxTotal > 0 ? (total / data.maxTotal) * 100 : 0
          const inputPct = total > 0 ? (input / total) * 100 : 0
          const color = getProviderColor(model.providerId)

          return (
            <Link
              key={model.id}
              href={model.href}
              className='-mx-2 flex items-center gap-3 rounded-md px-2 transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              <ModelLabel model={model} />
              <div className='relative flex h-7 min-w-0 flex-1 items-center'>
                <div
                  className='flex h-full overflow-hidden rounded-r-[3px]'
                  style={{ width: `${Math.max(totalPct, 3)}%` }}
                >
                  <div
                    className='h-full'
                    style={{
                      width: `${inputPct}%`,
                      backgroundColor: color,
                      opacity: 0.8,
                    }}
                  />
                  <div
                    className='h-full'
                    style={{
                      width: `${100 - inputPct}%`,
                      backgroundColor: color,
                      opacity: 0.35,
                    }}
                  />
                </div>
                <span className='ml-2.5 shrink-0 font-mono text-[var(--landing-text-muted)] text-xs'>
                  {formatPrice(input)} input / {formatPrice(output)} output
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function ContextWindowChart({ models }: ChartProps) {
  const data = useMemo(() => {
    const entries = models
      .map((model) => ({
        model,
        value: model.contextWindow,
      }))
      .filter((e): e is { model: CatalogModel; value: number } => e.value !== null && e.value > 0)
      .sort((a, b) => a.value - b.value)

    const maxValue = entries.length > 0 ? Math.max(...entries.map((e) => e.value)) : 0
    return { entries, maxValue }
  }, [models])

  if (data.entries.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'>
          Context window
        </h3>
        <span className='font-[430] font-season text-[var(--landing-text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          Max tokens
        </span>
      </div>

      <div className='flex flex-col gap-1.5'>
        {data.entries.map(({ model, value }) => {
          const pct = data.maxValue > 0 ? (value / data.maxValue) * 100 : 0
          const color = getProviderColor(model.providerId)

          return (
            <Link
              key={model.id}
              href={model.href}
              className='-mx-2 flex items-center gap-3 rounded-md px-2 transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              <ModelLabel model={model} />
              <div className='relative flex h-7 min-w-0 flex-1 items-center'>
                <div
                  className='h-full rounded-r-[3px]'
                  style={{
                    width: `${Math.max(pct, 3)}%`,
                    backgroundColor: color,
                    opacity: 0.8,
                  }}
                />
                <span className='ml-2.5 shrink-0 font-mono text-[var(--landing-text-muted)] text-xs'>
                  {formatTokenCount(value)}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

interface ModelComparisonChartsProps {
  models: CatalogModel[]
}

export function ModelComparisonCharts({ models }: ModelComparisonChartsProps) {
  const comparisonModels = useMemo(() => selectComparisonModels(models), [models])

  return (
    <section aria-labelledby='comparison-heading'>
      <div className='px-6 pt-10 pb-4'>
        <h2
          id='comparison-heading'
          className='mb-2 text-[20px] text-white leading-[100%] tracking-[-0.02em] lg:text-[24px]'
        >
          Compare models
        </h2>
        <p className='font-[430] font-season text-[var(--landing-text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          Side-by-side comparison of top models across key metrics.
        </p>
      </div>

      <div className='h-px w-full bg-[var(--landing-bg-elevated)]' />

      <div className='flex flex-col sm:flex-row'>
        <div className='flex-1 p-6'>
          <StackedCostChart models={comparisonModels} />
        </div>
        <div className='h-px w-full bg-[var(--landing-bg-elevated)] sm:h-auto sm:w-px' />
        <div className='flex-1 p-6'>
          <ContextWindowChart models={comparisonModels} />
        </div>
      </div>
    </section>
  )
}
