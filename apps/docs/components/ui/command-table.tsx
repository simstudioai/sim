import type { ReactNode } from 'react'

interface CommandTableProps {
  children: ReactNode
}

/**
 * Column sizing for the generated CLI reference tables.
 *
 * Auto layout gives a column width in proportion to its content, which is
 * backwards here: descriptions are sentences and flags are short, so the flag
 * column collapsed until `--enabled-filter <value>` wrapped across three lines
 * while the description beside it kept most of the row empty. A fixed layout
 * with explicit widths reserves the space the flag actually needs.
 *
 * Cells align to the top because a wrapped four-line description would
 * otherwise float its flag into the middle of the row, away from the line it
 * belongs to.
 */
export function CommandTable({ children }: CommandTableProps) {
  return (
    <div
      className={[
        '[&_table]:w-full [&_table]:table-fixed',
        '[&_th:nth-child(1)]:w-[30%] [&_th:nth-child(2)]:w-[5.5rem]',
        '[&_td]:align-top [&_th]:align-bottom',
        // Long flags and dotted paths have no spaces to break on.
        '[&_td:nth-child(1)_code]:break-words',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
