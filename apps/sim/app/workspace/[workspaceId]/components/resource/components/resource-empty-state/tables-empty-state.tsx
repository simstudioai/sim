import { cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'

/**
 * Neutral ink at graded strengths.
 *
 * `--surface-4`/`--surface-5` are near-white in light mode (`#f5f5f5`/`#f3f3f3`),
 * so skeleton geometry built on them dissolves on a white card. Mixing
 * `--text-secondary` into transparent instead gives a real mid-grey that inverts
 * with the theme — the same idiom the workflow editor's empty state uses for the
 * one bar it needs you to actually see.
 */
const INK = {
  header: 'color-mix(in srgb, var(--text-secondary) 32%, transparent)',
  headerType: 'color-mix(in srgb, var(--text-secondary) 26%, transparent)',
  cell: 'color-mix(in srgb, var(--text-secondary) 17%, transparent)',
  selection: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
} as const

const COLUMN_TEMPLATE = '84px 66px 66px 66px'

/** Header label widths, then per-row cell widths — varied so the grid reads as data. */
const HEADER_WIDTHS = [34, 26, 24, 26] as const

const CELL_WIDTHS = [
  [52, 34, 26, 38],
  [44, 30, 32, 30],
  [58, 38, 22, 40],
  [38, 26, 30, 32],
] as const

/**
 * A crisp table card whose columns run past its right edge.
 *
 * The workflow editor's vignette keeps its block fully opaque and fades only the
 * connector strokes leaving the frame; masking the whole composition is what
 * makes a miniature look washed rather than deliberate. So the card here stays
 * sharp and the continuation is drawn the way a real table draws it — an
 * overflow fade at the edge the columns run off.
 */
function TablesGraphic() {
  return (
    <div aria-hidden='true' className='relative h-[148px] w-[320px]'>
      <div className='absolute top-[16px] left-[34px] h-[116px] w-[252px] overflow-hidden rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
        <div
          className='grid border-[var(--border-1)] border-b bg-[var(--surface-3)]'
          style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
        >
          {HEADER_WIDTHS.map((width, column) => (
            <div
              key={`header-${column}`}
              className='flex h-[28px] items-center gap-[6px] border-[var(--border-1)] border-r px-2.5'
            >
              <span
                className='size-[7px] shrink-0 rounded-[2px]'
                style={{ background: INK.headerType }}
              />
              <span
                className='block h-[6px] rounded-full'
                style={{ width, background: INK.header }}
              />
            </div>
          ))}
        </div>

        {CELL_WIDTHS.map((row, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className={cn(
              'grid',
              rowIndex < CELL_WIDTHS.length - 1 && 'border-[var(--border-1)] border-b'
            )}
            style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
          >
            {row.map((width, column) => (
              <div
                key={`cell-${rowIndex}-${column}`}
                className='relative flex h-[22px] items-center border-[var(--border-1)] border-r px-2.5'
              >
                <span
                  className='block h-[6px] rounded-full'
                  style={{ width, background: INK.cell }}
                />
                {rowIndex === 1 && column === 1 ? (
                  <span
                    className='absolute inset-[-1px] rounded-[3px] border-[1.5px]'
                    style={{ borderColor: INK.selection }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ))}

        <span className='absolute top-0 right-0 h-[28px] w-[30px] bg-gradient-to-l from-[var(--surface-3)] to-transparent' />
        <span className='absolute top-[28px] right-0 bottom-0 w-[30px] bg-gradient-to-l from-[var(--surface-2)] to-transparent' />
      </div>
    </div>
  )
}

/** Empty state for the tables list when the workspace has none. */
export function TablesEmptyState() {
  return (
    <EmptyState
      graphic={<TablesGraphic />}
      title='No tables yet'
      description='Create a table to store structured data your agents can read and write.'
    />
  )
}
