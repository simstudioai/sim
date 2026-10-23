'use client'

import { useId } from 'react'
import { ChipInput } from '@sim/emcn'
import Link from 'next/link'
import { debounce, useQueryStates } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  COUNT_FIELDS,
  type CountParam,
  DAYS_PER_MONTH,
  MAX_REQUESTS_PER_DAY,
  MAX_TOKENS_PER_REQUEST,
} from '@/app/(landing)/models/(shell)/pricing-calculator/components/pricing-calculator/fields'
import { PricingCalculatorFootnote } from '@/app/(landing)/models/(shell)/pricing-calculator/components/pricing-calculator/pricing-calculator-fallback'
import {
  pricingCalculatorParsers,
  pricingCalculatorUrlKeys,
} from '@/app/(landing)/models/(shell)/pricing-calculator/search-params'
import { ModelMultiSelect } from '@/app/(landing)/models/components/model-multi-select'
import { formatUsd, resolveToolModels } from '@/app/(landing)/models/tools'
import { type CatalogModel, formatPrice, formatTokenCount } from '@/app/(landing)/models/utils'
import { priceTokenUsage, resolveModelTokenPricing } from '@/providers/pricing'

const NUMBER_URL_WRITE = { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) }

function clampCount(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0
}

function parseCount(raw: string, max: number): number {
  const digits = raw.replace(/\D/g, '')
  return digits ? clampCount(Number(digits), max) : 0
}

interface CostRow {
  model: CatalogModel
  perRequest: number
  inputRate: number
  cachedInputRate: number | undefined
  outputRate: number
  tierThreshold: number | null
}

function buildCostRow(
  model: CatalogModel,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number
): CostRow {
  const cost = priceTokenUsage(model.pricing, {
    input: inputTokens - cachedTokens,
    cacheRead: cachedTokens,
    output: outputTokens,
  })
  const rates = resolveModelTokenPricing(model.pricing, inputTokens)

  return {
    model,
    perRequest: cost.total,
    inputRate: rates.input,
    cachedInputRate: rates.cachedInput,
    outputRate: rates.output,
    tierThreshold: 'aboveInputTokens' in rates ? rates.aboveInputTokens : null,
  }
}

/**
 * Interactive LLM API cost estimator. Prices every selected model with
 * `priceTokenUsage`, the computation Sim's billing path uses, so input-size
 * tiers and cached-input rates apply exactly as they do on a real model call.
 */
export function PricingCalculator() {
  const fieldId = useId()
  const [params, setParams] = useQueryStates(pricingCalculatorParsers, pricingCalculatorUrlKeys)

  const inputTokens = clampCount(params.input, MAX_TOKENS_PER_REQUEST)
  const outputTokens = clampCount(params.output, MAX_TOKENS_PER_REQUEST)
  const cachedPercent = clampCount(params.cached, 100)
  const requestsPerDay = clampCount(params.requests, MAX_REQUESTS_PER_DAY)
  const counts: Record<CountParam, number> = {
    input: inputTokens,
    output: outputTokens,
    cached: cachedPercent,
    requests: requestsPerDay,
  }
  const cachedTokens = Math.round((inputTokens * cachedPercent) / 100)

  const selectedModels = resolveToolModels(params.models)
  const rows = selectedModels
    .map((model) => buildCostRow(model, inputTokens, cachedTokens, outputTokens))
    .sort((a, b) => a.perRequest - b.perRequest)

  return (
    <div className='flex flex-col'>
      <div className='flex flex-col gap-5 px-6 py-8'>
        <div className='flex flex-col gap-[9px]'>
          <span id={`${fieldId}-models`} className='text-[var(--text-muted)] text-small'>
            Models
          </span>
          <div className='max-w-[640px]'>
            <ModelMultiSelect
              labelId={`${fieldId}-models`}
              value={selectedModels.map((model) => model.id)}
              onChange={(models) => setParams({ models })}
            />
          </div>
        </div>

        <div className='grid grid-cols-4 gap-4 max-sm:grid-cols-1 max-lg:grid-cols-2'>
          {COUNT_FIELDS.map((field) => (
            <div key={field.key} className='flex flex-col gap-[9px]'>
              <label
                htmlFor={`${fieldId}-${field.key}`}
                className='text-[var(--text-muted)] text-small'
              >
                {field.label}
              </label>
              <ChipInput
                id={`${fieldId}-${field.key}`}
                inputMode='numeric'
                autoComplete='off'
                value={String(counts[field.key])}
                onChange={(event) =>
                  setParams(
                    { [field.key]: parseCount(event.target.value, field.max) },
                    NUMBER_URL_WRITE
                  )
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      {rows.length === 0 ? (
        <p className='px-6 py-10 text-[var(--text-muted)] text-sm'>
          Select one or more models to compare their cost.
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[560px] border-collapse text-left'>
            <caption className='sr-only'>
              Estimated cost per model for {inputTokens.toLocaleString('en-US')} input tokens (
              {cachedPercent}% cached) and {outputTokens.toLocaleString('en-US')} output tokens per
              request, at {requestsPerDay.toLocaleString('en-US')} requests per day
            </caption>
            <thead>
              <tr className='text-[var(--text-muted)] text-caption uppercase tracking-[0.1em]'>
                <th scope='col' className='px-6 py-3 font-normal'>
                  Model
                </th>
                <th scope='col' className='px-6 py-3 text-right font-normal'>
                  Per request
                </th>
                <th scope='col' className='px-6 py-3 text-right font-normal'>
                  Per day
                </th>
                <th scope='col' className='px-6 py-3 text-right font-normal'>
                  Per month
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CostTableRow
                  key={row.model.id}
                  row={row}
                  inputTokens={inputTokens}
                  cachedTokens={cachedTokens}
                  requestsPerDay={requestsPerDay}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PricingCalculatorFootnote />
    </div>
  )
}

interface CostTableRowProps {
  row: CostRow
  inputTokens: number
  cachedTokens: number
  requestsPerDay: number
}

function CostTableRow({ row, inputTokens, cachedTokens, requestsPerDay }: CostTableRowProps) {
  const { model } = row
  const notes: string[] = []

  if (row.tierThreshold !== null) {
    notes.push(`Long-context rate: input above ${formatTokenCount(row.tierThreshold)} tokens`)
  }
  if (cachedTokens > 0 && row.cachedInputRate === undefined) {
    notes.push('No cached-input rate, so cached tokens bill at the input rate')
  }
  if (model.contextWindow !== null && inputTokens > model.contextWindow) {
    notes.push(`Exceeds the ${formatTokenCount(model.contextWindow)} context window`)
  }

  return (
    <tr className='border-[var(--border)] border-t align-top'>
      <th scope='row' className='px-6 py-4 font-normal'>
        <Link
          href={model.href}
          className='text-[var(--text-primary)] text-sm hover:underline hover:underline-offset-2'
        >
          {model.displayName}
        </Link>
        <p className='mt-0.5 text-[var(--text-muted)] text-caption leading-[150%]'>
          {model.providerName} &middot; Input {formatPrice(row.inputRate)} &middot; Cached{' '}
          {row.cachedInputRate === undefined ? 'N/A' : formatPrice(row.cachedInputRate)} &middot;
          Output {formatPrice(row.outputRate)}
        </p>
        {notes.map((note) => (
          <p key={note} className='mt-0.5 text-[var(--text-secondary)] text-caption leading-[150%]'>
            {note}
          </p>
        ))}
      </th>
      <td className='px-6 py-4 text-right text-[var(--text-primary)] text-sm tabular-nums'>
        {formatUsd(row.perRequest)}
      </td>
      <td className='px-6 py-4 text-right text-[var(--text-primary)] text-sm tabular-nums'>
        {formatUsd(row.perRequest * requestsPerDay)}
      </td>
      <td className='px-6 py-4 text-right text-[var(--text-primary)] text-sm tabular-nums'>
        {formatUsd(row.perRequest * requestsPerDay * DAYS_PER_MONTH)}
      </td>
    </tr>
  )
}
