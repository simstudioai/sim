import { Chip, cn } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Neutral ink at two strengths.
 *
 * `--surface-4`/`--surface-5` are near-white in light mode (#f5f5f5/#f3f3f3), so
 * skeleton geometry built on them dissolves against the page. Mixing
 * `--text-secondary` into transparent gives a real mid-grey that inverts with the
 * theme — the idiom the workflow editor's vignette uses for the one bar it needs
 * you to actually see.
 */
const INK = {
  header: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  cell: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  /**
   * Mixed into `--bg` rather than `transparent`: a translucent ring lets the
   * grid rules underneath show through its own stroke. Opaque, and darker than
   * the ink it surrounds so it reads as chrome rather than more content.
   */
  selection: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/**
 * Crisp at the top-left, dissolving through the bottom-right — the same
 * two-gradient intersect the landing page's workflow vignette uses, so the grid
 * blends into the page rather than sitting on it as a card.
 */
const CORNER_FADE =
  '[-webkit-mask-image:linear-gradient(to_right,#000_62%,transparent_100%),linear-gradient(to_bottom,#000_56%,transparent_100%)] [mask-image:linear-gradient(to_right,#000_62%,transparent_100%),linear-gradient(to_bottom,#000_56%,transparent_100%)] [-webkit-mask-composite:source-in] [mask-composite:intersect]'

const COLUMN_TEMPLATE = '88px 72px 72px 72px'

const HEADER_WIDTHS = [36, 28, 26, 28] as const

const CELL_WIDTHS = [
  [54, 34, 26, 38],
  [44, 30, 34, 30],
  [60, 38, 22, 40],
  [40, 26, 30, 34],
  [50, 32, 28, 36],
] as const

/**
 * The one cell held in an edit ring, placed in the top-left quadrant the corner
 * fade leaves fully opaque — a selection dissolving mid-stroke would read as a
 * rendering fault rather than a detail.
 */
const SELECTED_CELL = { row: 1, column: 0 } as const

/** Skeleton grid with one cell held in an edit ring, running off two edges. */
function TablesGraphic() {
  return (
    <div
      aria-hidden='true'
      className={cn('relative h-[148px] w-[320px] overflow-hidden', CORNER_FADE, MASK_NO_REPEAT)}
    >
      <div className='absolute top-[14px] left-[54px] rounded-tl-[6px] border-[var(--border)] border-t border-l'>
        <div className='grid' style={{ gridTemplateColumns: COLUMN_TEMPLATE }}>
          {HEADER_WIDTHS.map((width, column) => (
            <div
              key={`header-${column}`}
              className='flex h-[26px] items-center border-[var(--border)] border-r border-b px-3'
            >
              <span
                className='block h-[5px] rounded-full'
                style={{ width, background: INK.header }}
              />
            </div>
          ))}
        </div>

        {CELL_WIDTHS.map((row, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className='grid'
            style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
          >
            {row.map((width, column) => (
              <div
                key={`cell-${rowIndex}-${column}`}
                className='relative flex h-[24px] items-center border-[var(--border)] border-r border-b px-3'
              >
                <span
                  className='block h-[5px] rounded-full'
                  style={{ width, background: INK.cell }}
                />
                {rowIndex === SELECTED_CELL.row && column === SELECTED_CELL.column ? (
                  <span
                    className='absolute inset-[-1px] z-10 rounded-[3px] border-[1.5px]'
                    style={{ borderColor: INK.selection }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const TABLES_DOCS_URL = 'https://docs.sim.ai/tables'

interface TablesEmptyStateProps {
  /** Creates a table — the same action the header's primary chip runs. */
  onCreate: () => void
  /** Mirrors the header chip's disabled state: no edit rights, or a create already in flight. */
  createDisabled?: boolean
}

/** Empty state for the tables list when the workspace has none. */
export function TablesEmptyState({ onCreate, createDisabled = false }: TablesEmptyStateProps) {
  return (
    <EmptyState
      graphic={<TablesGraphic />}
      title='Tables'
      description='Create a table to store structured data your agents can read and write.'
      action={
        <>
          <Chip variant='primary' onClick={onCreate} disabled={createDisabled} leftIcon={Plus}>
            New table
          </Chip>
          <EmptyStateDocsLink href={TABLES_DOCS_URL} />
        </>
      }
    />
  )
}
