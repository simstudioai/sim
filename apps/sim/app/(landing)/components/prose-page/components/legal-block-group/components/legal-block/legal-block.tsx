import { cn } from '@sim/emcn'
import { PROSE_SPACING, PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'
import type { LegalBlock } from '@/app/(landing)/components/prose-page/types'

/**
 * Renders a single {@link LegalBlock} into its canonical chrome. The block's
 * `kind` discriminant selects the element (paragraph / subheading `<h3>` /
 * bulleted list / callout box / reference table); all sizing and color come
 * from `PROSE_TYPE`, so Terms and Privacy share one visual treatment for every
 * block type. Content
 * only - no layout knob. Server Component.
 */

interface LegalBlockViewProps {
  block: LegalBlock
}

export function LegalBlockView({ block }: LegalBlockViewProps) {
  switch (block.kind) {
    case 'paragraph':
      return <p className={PROSE_TYPE.body}>{block.content}</p>
    case 'subheading':
      return <h3 className={PROSE_TYPE.h3}>{block.text}</h3>
    case 'list':
      return (
        <ul className={cn('list-disc', PROSE_SPACING.listIndent, PROSE_SPACING.listStack)}>
          {block.items.map((item, index) => {
            const itemKey = `item-${index}`
            return (
              <li key={itemKey} className={PROSE_TYPE.list}>
                {item}
              </li>
            )
          })}
        </ul>
      )
    case 'callout':
      return <div className={PROSE_TYPE.callout}>{block.content}</div>
    case 'table':
      return (
        <div className={PROSE_TYPE.tableWrap}>
          <table className={PROSE_TYPE.table}>
            {block.caption ? (
              <caption className={PROSE_TYPE.tableCaption}>{block.caption}</caption>
            ) : null}
            {block.columnWidths ? (
              <colgroup>
                {block.columnWidths.map((width, index) => (
                  <col key={`col-${index}`} className={width} />
                ))}
              </colgroup>
            ) : null}
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column} scope='col' className={PROSE_TYPE.tableHeadCell}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => {
                const rowKey = `row-${rowIndex}`
                return (
                  <tr key={rowKey}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowKey}-${cellIndex}`} className={PROSE_TYPE.tableCell}>
                        {block.codeColumns?.includes(cellIndex) ? <code>{cell}</code> : cell}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    default:
      return null
  }
}
