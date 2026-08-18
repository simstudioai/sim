import { EmptyState } from '@/components/empty-state/empty-state'
import {
  Bar,
  Vignette,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

/** Cell fill widths per column, row by row — varied so the grid reads as data, not a lattice. */
const CELL_WIDTHS = [
  [58, 40, 30, 44],
  [48, 34, 36, 38],
  [64, 44, 26, 46],
  [42, 30, 34, 36],
] as const

const COLUMN_TEMPLATE = '92px 76px 76px 76px'

/**
 * A sheet of cells running off the right and bottom edges, with one cell held in
 * an edit ring — a table is the only resource whose structure *is* its picture.
 */
function TablesGraphic() {
  return (
    <Vignette>
      <div
        className='absolute top-[16px] left-[30px] grid w-[320px] overflow-hidden rounded-tl-[8px] border-[var(--border-1)] border-t border-l'
        style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
      >
        {[0, 1, 2, 3].map((column) => (
          <div
            key={`header-${column}`}
            className='flex h-[26px] items-center gap-[6px] border-[var(--border-1)] border-r border-b bg-[var(--surface-3)] px-2.5'
          >
            <span className='size-[8px] shrink-0 rounded-[2px] bg-[var(--surface-6)]' />
            <Bar
              className='h-[7px] bg-[var(--surface-6)]'
              style={{ width: column === 0 ? 44 : 32 }}
            />
          </div>
        ))}

        {CELL_WIDTHS.map((row, rowIndex) =>
          row.map((width, column) => {
            const isEditing = rowIndex === 1 && column === 1
            return (
              <div
                key={`cell-${rowIndex}-${column}`}
                className='relative flex h-[26px] items-center border-[var(--border-1)] border-r border-b bg-[var(--surface-1)] px-2.5'
              >
                <Bar className='h-2' style={{ width }} />
                {isEditing ? (
                  <span className='absolute inset-[-1px] rounded-[3px] border-[1.5px] border-[var(--brand-secondary)]' />
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </Vignette>
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
