import { Table } from '@sim/emcn/icons'
import {
  type CodeSegment,
  CodeWindowGraphic,
} from '@/app/(landing)/components/shared/code-window-graphic'

/**
 * A `query-leads.ts` excerpt - agent logic reading rows out of the Leads
 * table and writing a result back, the table reached from code.
 */
const CODE_LINES: readonly CodeSegment[][] = [
  [
    { text: 'import', tone: 'muted' },
    { text: ' ' },
    { text: '{ tables }', tone: 'primary' },
    { text: ' ' },
    { text: 'from', tone: 'muted' },
    { text: ' ' },
    { text: "'@sim/sdk'", tone: 'primary' },
  ],
  [
    { text: 'const', tone: 'muted' },
    { text: ' ' },
    { text: 'leads', tone: 'primary' },
    { text: ' ' },
    { text: '= await', tone: 'muted' },
    { text: ' ' },
    { text: 'tables', tone: 'primary' },
  ],
  [{ text: "  .query('leads'", tone: 'primary' }, { text: ', {' }],
  [
    { text: '    ' },
    { text: 'where:', tone: 'muted' },
    { text: ' ' },
    { text: '{ qualified: true }', tone: 'primary' },
    { text: ',' },
  ],
  [
    { text: '    ' },
    { text: 'orderBy:', tone: 'muted' },
    { text: ' ' },
    { text: "'created_at'", tone: 'primary' },
    { text: ',' },
  ],
  [{ text: '  })' }],
] as const

/**
 * Querying tables from agent logic told in the shared
 * {@link CodeWindowGraphic} editor window: the `Table` mark and the
 * `query-leads.ts` filename over an SDK excerpt reading qualified leads
 * out of the Leads table.
 */
export function TableQueryGraphic() {
  return (
    <CodeWindowGraphic
      icon={<Table className='size-[14px] text-[var(--text-muted-inverse)]' />}
      filename='query-leads.ts'
      lines={CODE_LINES}
    />
  )
}
