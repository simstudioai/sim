import { cn } from '@sim/emcn'
import { Table, TypeBoolean, TypeText } from '@sim/emcn/icons'
import { LANDING_STAGE_WINDOW_RADIUS } from '@/app/(landing)/components/landing-layout'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/tables/components/feature-graphics/table-grid-graphic.module.css'

interface GridColumnDef {
  /** Column header label. */
  label: string
  /** Header type icon - text or boolean, per the real editor's headers. */
  type: 'text' | 'boolean'
}

/**
 * The Leads grid's cropped schema - the identity column plus two of the
 * fields agents keep current.
 */
const COLUMNS: readonly GridColumnDef[] = [
  { label: 'Name', type: 'text' },
  { label: 'Company', type: 'text' },
  { label: 'Qualified', type: 'boolean' },
] as const

interface GridRowDef {
  /** Cell values, left to right; the boolean renders as a check mark or dash. */
  cells: readonly [string, string, boolean]
}

/** The records the vignette stamps in, newest work landing last. */
const ROWS: readonly GridRowDef[] = [
  { cells: ['Alice Johnson', 'Acme Corp', true] },
  { cells: ['Bob Williams', 'TechCo', false] },
  { cells: ['Carol Davis', 'StartupCo', true] },
  { cells: ['Dan Miller', 'BigCorp', true] },
  { cells: ['Eva Chen', 'Design IO', false] },
] as const

/** Empty grid rows that fill the portrait window's leftover height. */
const EMPTY_ROW_COUNT = 6

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2, styles.row3, styles.row4] as const

/**
 * The Tables grid told inside a product window framed on all sides, wearing
 * the light tiles' card chrome - `--white` fill, 1px `--border` hairline,
 * `shadow-xs` - so the grid reads as the workspace's own editor. Its `h-12`
 * title bar pairs the `Table` icon (in a hairline `size-6` icon box) with
 * the `Leads` table name over a hairline
 * rule, and the grid below is the landing Tables preview's exact cell
 * vocabulary: typed column headers (`TypeText`/`TypeBoolean` icons),
 * hairline-ruled cells, the boolean column rendered as quiet check marks and
 * dashes. Columns size to the stage and leftover height fills with empty grid
 * rows so the editor reads at the tall crop.
 *
 * The record rows stamp in top to bottom once (from
 * `table-grid-graphic.module.css`, the audit tile's one-shot settle) - an
 * agent writing records, never re-played. Under `prefers-reduced-motion`
 * the grid renders fully settled.
 */
export function TableGridGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div
        aria-hidden='true'
        className={cn(
          'absolute inset-[10px] overflow-hidden border border-[var(--border)] bg-[var(--white)] shadow-xs dark:bg-[var(--surface-4)]',
          LANDING_STAGE_WINDOW_RADIUS
        )}
      >
        <div className='flex h-12 items-center gap-2 border-[var(--border)] border-b px-4'>
          <span className='flex size-6 items-center justify-center rounded-md border border-[var(--border)]'>
            <Table className='size-[14px] text-[var(--text-icon)]' />
          </span>
          <span className='text-[var(--text-primary)] text-base'>Leads</span>
        </div>

        <div className='flex border-[var(--border)] border-b'>
          {COLUMNS.map((column) => {
            const Icon = column.type === 'boolean' ? TypeBoolean : TypeText
            return (
              <div
                key={column.label}
                className='flex min-w-0 flex-1 items-center gap-1.5 border-[var(--border)] border-r px-2.5 py-2 last:border-r-0'
              >
                <Icon className='size-3 shrink-0 text-[var(--text-icon)]' />
                <span className='truncate text-[var(--text-primary)] text-caption'>
                  {column.label}
                </span>
              </div>
            )
          })}
        </div>

        {ROWS.map((row, index) => (
          <div
            key={row.cells[0]}
            className={cn('flex border-[var(--border)] border-b', ROW_STEP_CLASSES[index])}
          >
            {COLUMNS.map((column, columnIndex) => {
              const value = row.cells[columnIndex]
              return (
                <div
                  key={column.label}
                  className={cn(
                    'min-w-0 flex-1 truncate border-[var(--border)] border-r px-2.5 py-2 text-caption last:border-r-0',
                    columnIndex === 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                  )}
                >
                  {typeof value === 'boolean' ? (value ? '✓' : '—') : value}
                </div>
              )
            })}
          </div>
        ))}

        {Array.from({ length: EMPTY_ROW_COUNT }, (_, index) => (
          <div key={`empty-${index}`} className='flex border-[var(--border)] border-b'>
            {COLUMNS.map((column) => (
              <div
                key={column.label}
                className='h-9 min-w-0 flex-1 border-[var(--border)] border-r last:border-r-0'
              />
            ))}
          </div>
        ))}
      </div>
    </FeatureGraphicShell>
  )
}
