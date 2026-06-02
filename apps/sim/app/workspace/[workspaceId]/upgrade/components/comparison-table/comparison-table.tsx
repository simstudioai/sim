'use client'

import { chipVariants } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { BillingPeriodToggle } from '@/app/workspace/[workspaceId]/upgrade/components/billing-period-toggle/billing-period-toggle'
import {
  type CellValue,
  COMPARISON_SECTIONS,
  PLAN_COLUMNS,
  type PlanName,
} from '@/app/workspace/[workspaceId]/upgrade/components/comparison-table/comparison-data'

/**
 * Props for {@link ComparisonTable}.
 */
export interface ComparisonTableProps {
  /**
   * Resolved Pro price string, e.g. `"$29"`.
   * Sourced from the page-level `proPrice` derived from `useUpgradeState`.
   */
  proPrice: string
  /**
   * Resolved Max price string, e.g. `"$79"`.
   * Sourced from the page-level `maxPrice` derived from `useUpgradeState`.
   */
  maxPrice: string
  /**
   * Whether annual billing is currently selected.
   * Shared with the page-level {@link BillingPeriodToggle} via a single state source.
   */
  isAnnual: boolean
  /**
   * Invoked when the in-table billing toggle changes.
   * Should point to the same setter as the page-level toggle.
   */
  onIsAnnualChange: (isAnnual: boolean) => void
  /** Invoked with the plan name when a column's CTA chip is clicked. */
  onSelectPlan: (planName: PlanName) => void
}

/**
 * Inline check icon — matches the card-level `CheckIcon` shape.
 */
function CheckIcon() {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 14 14'
      fill='none'
      aria-hidden='true'
      className='size-[14px] flex-shrink-0'
    >
      <path
        d='M2.5 7L5.5 10L11.5 4'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/**
 * Renders a single cell value: `true` → check icon, `false` → em-dash, string → text.
 */
function Cell({ value }: { value: CellValue }) {
  if (value === true) {
    return (
      <span className='flex justify-center text-[var(--text-primary)]'>
        <CheckIcon />
      </span>
    )
  }
  if (value === false) {
    return (
      <span className='flex select-none justify-center text-[var(--text-muted)] text-base'>—</span>
    )
  }
  return (
    <span className='block text-center text-[var(--text-primary)] text-small tabular-nums'>
      {value}
    </span>
  )
}

/**
 * Full plan-comparison table. Renders all sections from {@link COMPARISON_SECTIONS}
 * mapped over generically — no per-cell copy-paste. Prices for Pro and Max are
 * supplied as props so they stay in sync with the billing-period toggle in the
 * parent page.
 *
 * The top-left cell contains a "Compare plans" heading, a subtitle, and a
 * {@link BillingPeriodToggle} that shares state with the page-level toggle via
 * the `isAnnual` / `onIsAnnualChange` props.
 *
 * @example
 * ```tsx
 * <ComparisonTable
 *   proPrice={`$${proPrice}`}
 *   maxPrice={`$${maxPrice}`}
 *   isAnnual={state.isAnnual}
 *   onIsAnnualChange={state.setIsAnnual}
 * />
 * ```
 */
export function ComparisonTable({
  proPrice,
  maxPrice,
  isAnnual,
  onIsAnnualChange,
  onSelectPlan,
}: ComparisonTableProps) {
  const runtimePrices: Partial<Record<PlanName, string>> = {
    Pro: proPrice,
    Max: maxPrice,
  }

  return (
    <div className='w-full overflow-x-auto rounded-xl border border-[var(--border-1)]'>
      {/* CSS grid: 1 label col + 4 equal plan cols */}
      <div className='grid min-w-[640px] grid-cols-[1fr_repeat(4,minmax(0,1fr))]'>
        {/* ── Column headers ── */}
        {/* Top-left cell: title, subtitle, and billing toggle */}
        <div className='flex h-full flex-col justify-between gap-3 border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-3'>
          <div className='flex flex-col gap-0.5'>
            <span className='font-medium text-[var(--text-primary)] text-small'>Compare plans</span>
            <span className='text-[var(--text-muted)] text-base'>Find the right plan for you</span>
          </div>
          <BillingPeriodToggle isAnnual={isAnnual} onChange={onIsAnnualChange} />
        </div>

        {PLAN_COLUMNS.map((col) => {
          const price = runtimePrices[col.name] ?? col.staticPrice ?? ''

          return (
            <div
              key={col.name}
              className='flex flex-col items-center gap-1 bg-[var(--surface-2)] px-3 py-4 text-center'
            >
              <span className='font-medium text-[var(--text-primary)] text-base'>{col.name}</span>
              <span className='font-medium text-[var(--text-primary)] text-md tabular-nums'>
                {price}
              </span>
              <button
                type='button'
                onClick={() => onSelectPlan(col.name)}
                aria-label={`${col.ctaLabel} — ${col.name}`}
                className={cn(
                  chipVariants({
                    variant: col.highlighted ? 'primary' : 'border-shadow',
                    fullWidth: true,
                    flush: true,
                  }),
                  'mt-2 w-full justify-center'
                )}
              >
                {col.ctaLabel}
              </button>
            </div>
          )
        })}

        {/* ── Sections ── */}
        {COMPARISON_SECTIONS.map((section, sectionIdx) => (
          <div key={section.title} className='contents'>
            {/* Section header row — split so the left-column separator stays continuous */}
            <div
              className={cn(
                'border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-2',
                sectionIdx > 0 && 'border-[var(--border-1)] border-t'
              )}
            >
              <span className='font-medium text-[var(--text-primary)] text-small'>
                {section.title}
              </span>
            </div>
            <div
              className={cn(
                'col-span-4 bg-[var(--surface-2)]',
                sectionIdx > 0 && 'border-[var(--border-1)] border-t'
              )}
            />

            {/* Feature rows */}
            {section.rows.map((row, rowIdx) => (
              <div key={row.label} className='contents'>
                {/* Label */}
                <div
                  className={cn(
                    'flex items-center border-[var(--border)] border-r bg-[var(--surface-1)] px-4 py-2.5',
                    rowIdx < section.rows.length - 1 && 'border-[var(--border-1)] border-b'
                  )}
                >
                  <span className='text-[var(--text-body)] text-small'>{row.label}</span>
                </div>

                {/* Plan cells */}
                {row.values.map((value, colIdx) => (
                  <div
                    key={PLAN_COLUMNS[colIdx].name}
                    className={cn(
                      'flex items-center justify-center bg-[var(--surface-2)] px-3 py-2.5',
                      rowIdx < section.rows.length - 1 && 'border-[var(--border-1)] border-b'
                    )}
                  >
                    <Cell value={value} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
