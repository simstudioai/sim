import { chipFieldSurfaceClass, chipGeometryClass, cn } from '@sim/emcn'
import {
  COUNT_FIELDS,
  DAYS_PER_MONTH,
} from '@/app/(landing)/models/(shell)/pricing-calculator/components/pricing-calculator/fields'
import { DEFAULT_TOOL_MODEL_IDS } from '@/app/(landing)/models/tools'

const FIELD_BOX_CLASS = cn(
  'flex w-full max-md:pointer-coarse:min-h-11',
  chipGeometryClass,
  chipFieldSurfaceClass
)
const COST_COLUMNS = ['Per request', 'Per day', 'Per month'] as const

/** The calculator's closing note, shared by the island and its fallback so both wrap identically. */
export function PricingCalculatorFootnote() {
  return (
    <p className='border-[var(--border)] border-t px-6 py-4 text-[var(--text-muted)] text-caption leading-[150%]'>
      Rates are list prices in USD per 1M tokens, and a month is {DAYS_PER_MONTH} days. Reasoning
      tokens bill as output, so count them in output tokens. Prompt-cache writes and tool calls are
      not included.
    </p>
  )
}

/**
 * Static stand-in for {@link PricingCalculator} while it renders on the client
 * (its `useQueryStates` reads the URL, so the statically generated page cannot
 * prerender it). Mirrors the island's labels, field boxes, and one empty table
 * row per default model so the page does not shift when the island mounts.
 */
export function PricingCalculatorFallback() {
  return (
    <div aria-hidden className='flex flex-col'>
      <div className='flex flex-col gap-5 px-6 py-8'>
        <div className='flex flex-col gap-[9px]'>
          <span className='text-[var(--text-muted)] text-small'>Models</span>
          <div className='max-w-[640px]'>
            <div className={FIELD_BOX_CLASS} />
          </div>
        </div>

        <div className='grid grid-cols-4 gap-4 max-sm:grid-cols-1 max-lg:grid-cols-2'>
          {COUNT_FIELDS.map((field) => (
            <div key={field.key} className='flex flex-col gap-[9px]'>
              <span className='text-[var(--text-muted)] text-small'>{field.label}</span>
              <div className={FIELD_BOX_CLASS} />
            </div>
          ))}
        </div>
      </div>

      <div className='h-px w-full bg-[var(--border)]' />

      <div className='overflow-x-auto'>
        <table className='w-full min-w-[560px] border-collapse text-left'>
          <thead>
            <tr className='text-[var(--text-muted)] text-caption uppercase tracking-[0.1em]'>
              <th scope='col' className='px-6 py-3 font-normal'>
                Model
              </th>
              {COST_COLUMNS.map((column) => (
                <th key={column} scope='col' className='px-6 py-3 text-right font-normal'>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEFAULT_TOOL_MODEL_IDS.map((modelId) => (
              <tr key={modelId} className='border-[var(--border)] border-t align-top'>
                <th scope='row' className='px-6 py-4 font-normal'>
                  <span className='text-sm'>&nbsp;</span>
                  <p className='mt-0.5 text-caption leading-[150%]'>&nbsp;</p>
                </th>
                {COST_COLUMNS.map((column) => (
                  <td key={column} className='px-6 py-4 text-sm' />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PricingCalculatorFootnote />
    </div>
  )
}
