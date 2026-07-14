import { cn } from '@sim/emcn'
import { Table, TypeBoolean, TypeText } from '@sim/emcn/icons'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics'
import styles from '@/app/(landing)/tables/components/feature-graphics/table-grid-graphic.module.css'

interface GridColumnDef {
  /** Column header label. */
  label: string
  /** Header type icon - text or boolean, per the real editor's headers. */
  type: 'text' | 'boolean'
  /** Tailwind width class in the window's fixed geometry. */
  widthClass: string
}

/**
 * The Leads grid's cropped schema - the identity column plus two of the
 * fields agents keep current, with the boolean column bleeding off the
 * window's cropped right edge.
 */
const COLUMNS: readonly GridColumnDef[] = [
  { label: 'Name', type: 'text', widthClass: 'w-[128px]' },
  { label: 'Company', type: 'text', widthClass: 'w-[118px]' },
  { label: 'Qualified', type: 'boolean', widthClass: 'flex-1' },
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

/** Per-row stamp-in classes - the stagger order is baked into each class's delay. */
const ROW_STEP_CLASSES = [styles.row0, styles.row1, styles.row2, styles.row3, styles.row4] as const

/**
 * The Tables grid told inside a cropped product window: the window keeps
 * the dark tiles' slot geometry (`top-5`, `left-0`, bleeding off the right
 * and bottom edges, `rounded-tl-xl`) but wears the light tiles' card
 * chrome - `--white` fill, 1px `--border-1` hairline, `shadow-sm` - so the
 * grid reads as the workspace's own editor. Its `h-12` title bar pairs the
 * `Table` icon (in a hairline `size-6` icon box, the lifecycle header's
 * treatment) with the `Leads` table name over a hairline rule, and the
 * grid below is the landing Tables preview's exact cell vocabulary: typed
 * column headers (`TypeText`/`TypeBoolean` icons), hairline-ruled cells,
 * the boolean column rendered as quiet check marks and dashes.
 *
 * The record rows stamp in top to bottom once (from
 * `table-grid-graphic.module.css`, the audit tile's one-shot settle) - an
 * agent writing records, never re-played. Under `prefers-reduced-motion`
 * the grid renders fully settled.
 */
export function TableGridGraphic() {
  return (
    <FeatureGraphicShell>
      <div
        aria-hidden='true'
        className='absolute top-5 right-0 bottom-0 left-0 overflow-hidden rounded-tl-xl border-[var(--border-1)] border-t border-l bg-[var(--white)] shadow-sm'
      >
        <div className='flex h-12 items-center gap-2 border-[var(--border-1)] border-b px-4'>
          <span className='flex size-6 items-center justify-center rounded-md border border-[var(--border-1)]'>
            <Table className='size-[14px] text-[var(--text-icon)]' />
          </span>
          <span className='font-medium text-[var(--text-primary)] text-base'>Leads</span>
        </div>

        <div className='flex border-[var(--border-1)] border-b'>
          {COLUMNS.map((column) => {
            const Icon = column.type === 'boolean' ? TypeBoolean : TypeText
            return (
              <div
                key={column.label}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-[var(--border-1)] border-r px-2.5 py-2 last:border-r-0',
                  column.widthClass
                )}
              >
                <Icon className='size-3 shrink-0 text-[var(--text-icon)]' />
                <span className='truncate font-medium text-[var(--text-primary)] text-caption'>
                  {column.label}
                </span>
              </div>
            )
          })}
        </div>

        {ROWS.map((row, index) => (
          <div
            key={row.cells[0]}
            className={cn('flex border-[var(--border-1)] border-b', ROW_STEP_CLASSES[index])}
          >
            {COLUMNS.map((column, columnIndex) => {
              const value = row.cells[columnIndex]
              return (
                <div
                  key={column.label}
                  className={cn(
                    'shrink-0 truncate border-[var(--border-1)] border-r px-2.5 py-2 text-caption last:border-r-0',
                    columnIndex === 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
                    column.widthClass
                  )}
                >
                  {typeof value === 'boolean' ? (value ? '✓' : '—') : value}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </FeatureGraphicShell>
  )
}
