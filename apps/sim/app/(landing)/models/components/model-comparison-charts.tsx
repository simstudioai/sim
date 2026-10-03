import type { ComponentType } from 'react'
import Link from 'next/link'
import { getProviderColor } from '@/app/(landing)/models/components/constants'
import type { CatalogModel } from '@/app/(landing)/models/utils'
import {
  formatPrice,
  formatTokenCount,
  MODEL_CATALOG_PROVIDERS,
} from '@/app/(landing)/models/utils'

/** Flagship providers featured in the landing-page comparison, in display order. */
const FEATURED_COMPARISON_PROVIDER_IDS = ['anthropic', 'openai', 'google']

/** Max latest models pulled from each featured provider. */
const MAX_MODELS_PER_PROVIDER = 4
const CHART_BAR_HEIGHT = 1
const CHART_BAR_END_RADIUS_X = 1
const CHART_BAR_END_RADIUS_Y = 3 / 28

const PROVIDER_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = (() => {
  const map: Record<string, ComponentType<{ className?: string }>> = {}
  for (const provider of MODEL_CATALOG_PROVIDERS) {
    if (provider.icon) {
      map[provider.id] = provider.icon
    }
  }
  return map
})()

function getRoundedRightBarPath(x: number, width: number): string {
  const right = x + width
  const radiusX = Math.min(CHART_BAR_END_RADIUS_X, width / 2)
  const radiusY = CHART_BAR_END_RADIUS_Y

  return `M ${x} 0 H ${right - radiusX} Q ${right} 0 ${right} ${radiusY} V ${CHART_BAR_HEIGHT - radiusY} Q ${right} ${CHART_BAR_HEIGHT} ${right - radiusX} ${CHART_BAR_HEIGHT} H ${x} Z`
}

function selectComparisonModels(models: CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>()
  const result: CatalogModel[] = []

  for (const providerId of FEATURED_COMPARISON_PROVIDER_IDS) {
    const providerModels = models
      .filter((model) => model.providerId === providerId && !model.deprecated)
      .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))

    let takenForProvider = 0
    for (const model of providerModels) {
      if (takenForProvider >= MAX_MODELS_PER_PROVIDER) break

      const nameKey = model.displayName.toLowerCase()
      if (seen.has(nameKey)) continue

      seen.add(nameKey)
      result.push(model)
      takenForProvider += 1
    }
  }

  return result
}

interface ModelLabelProps {
  model: CatalogModel
}

function ModelLabel({ model }: ModelLabelProps) {
  const Icon = PROVIDER_ICON_MAP[model.providerId]

  return (
    <div className='flex w-[90px] shrink-0 items-center justify-end gap-1.5 sm:w-[140px] lg:w-[180px]'>
      {Icon && (
        <span aria-hidden='true' className='shrink-0'>
          <Icon className='size-3.5' />
        </span>
      )}
      <span className='truncate text-[13px] text-[var(--text-primary)] leading-none tracking-[-0.01em]'>
        {model.displayName}
      </span>
    </div>
  )
}

interface ChartProps {
  models: CatalogModel[]
}

function StackedCostChart({ models }: ChartProps) {
  const entries = models
    .reduce<Array<{ model: CatalogModel; input: number; output: number; total: number }>>(
      (acc, model) => {
        const total = model.pricing.input + model.pricing.output
        if (total > 0) {
          acc.push({ model, input: model.pricing.input, output: model.pricing.output, total })
        }
        return acc
      },
      []
    )
    .sort((a, b) => a.total - b.total)

  const maxTotal = entries.length > 0 ? Math.max(...entries.map((e) => e.total)) : 0
  const data = { entries, maxTotal }

  if (data.entries.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'>
          Cost
        </h3>
        <span className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          Standard short-context rates per 1M tokens
        </span>
      </div>

      <div className='flex flex-col gap-1.5'>
        {data.entries.map(({ model, input, output, total }) => {
          const totalPct = data.maxTotal > 0 ? (total / data.maxTotal) * 100 : 0
          const inputPct = total > 0 ? (input / total) * 100 : 0
          const plottedTotalPct = Math.max(totalPct, 3)
          const plottedInputPct = (plottedTotalPct * inputPct) / 100
          const plottedOutputPct = plottedTotalPct - plottedInputPct
          const color = getProviderColor(model.providerId)

          return (
            <Link
              key={model.id}
              href={model.href}
              className='-mx-2 flex items-center gap-3 rounded-md px-2 transition-colors hover:bg-[var(--surface-hover)]'
            >
              <ModelLabel model={model} />
              <div className='flex h-7 min-w-0 flex-1 items-center gap-2.5'>
                <div className='hidden h-full min-w-0 flex-1 sm:block'>
                  <svg
                    aria-hidden='true'
                    className='size-full'
                    preserveAspectRatio='none'
                    viewBox='0 0 100 1'
                  >
                    {plottedInputPct > 0 &&
                      (plottedOutputPct > 0 ? (
                        <rect fill={color} fillOpacity={0.8} height='1' width={plottedInputPct} />
                      ) : (
                        <path
                          d={getRoundedRightBarPath(0, plottedInputPct)}
                          fill={color}
                          fillOpacity={0.8}
                        />
                      ))}
                    {plottedOutputPct > 0 && (
                      <path
                        d={getRoundedRightBarPath(plottedInputPct, plottedOutputPct)}
                        fill={color}
                        fillOpacity={0.35}
                      />
                    )}
                  </svg>
                </div>
                <span className='shrink-0 text-[11px] text-[var(--text-muted)] sm:w-[148px] sm:text-xs'>
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
  const entries = models
    .map((model) => ({
      model,
      value: model.contextWindow,
    }))
    .filter((e): e is { model: CatalogModel; value: number } => e.value !== null && e.value > 0)
    .sort((a, b) => a.value - b.value)

  const maxValue = entries.length > 0 ? Math.max(...entries.map((e) => e.value)) : 0
  const data = { entries, maxValue }

  if (data.entries.length === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h3 className='text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'>
          Context window
        </h3>
        <span className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
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
              className='-mx-2 flex items-center gap-3 rounded-md px-2 transition-colors hover:bg-[var(--surface-hover)]'
            >
              <ModelLabel model={model} />
              <div className='flex h-7 min-w-0 flex-1 items-center gap-2.5'>
                <div className='h-full min-w-0 flex-1'>
                  <svg
                    aria-hidden='true'
                    className='size-full'
                    preserveAspectRatio='none'
                    viewBox='0 0 100 1'
                  >
                    <path
                      d={getRoundedRightBarPath(0, Math.max(pct, 3))}
                      fill={color}
                      fillOpacity={0.8}
                    />
                  </svg>
                </div>
                <span className='w-10 shrink-0 text-right text-[11px] text-[var(--text-muted)] tabular-nums sm:text-xs'>
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
  const comparisonModels = selectComparisonModels(models)

  return (
    <section aria-labelledby='comparison-heading'>
      <div className='px-6 pt-10 pb-4'>
        <h2
          id='comparison-heading'
          className='mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
        >
          Compare models
        </h2>
        <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          Side-by-side comparison of top models across key metrics.
        </p>
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      <div className='flex flex-col lg:flex-row'>
        <div className='flex-1 p-6'>
          <StackedCostChart models={comparisonModels} />
        </div>
        <div className='h-px w-full bg-[var(--border)] lg:h-auto lg:w-px' />
        <div className='flex-1 p-6'>
          <ContextWindowChart models={comparisonModels} />
        </div>
      </div>
    </section>
  )
}
