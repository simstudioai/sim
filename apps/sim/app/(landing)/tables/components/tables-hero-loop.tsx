'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Checkbox, cn } from '@sim/emcn'
import { ChevronDown, Table, TypeBoolean, TypeText } from '@sim/emcn/icons'
import { EnterpriseSidebar } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import styles from '@/app/(landing)/tables/components/tables-hero-loop.module.css'

/**
 * The window interior's design space - the same 1280x735 "mini app" geometry
 * the enterprise and workflows loops use, so every platform hero reads at
 * the identical scale inside the shared demo window.
 */
const DESIGN = { width: 1280, height: 735 } as const

/** Sidebar content for the tables hero - a data-minded workspace. */
const SIDEBAR_CHATS = [
  'Lead intake agent',
  'Enrichment backfill',
  'Dedupe the leads table',
  'Weekly pipeline digest',
] as const

/** Deployed workflows in the sidebar - five fill the design height. */
const SIDEBAR_WORKFLOWS = [
  'Lead intake',
  'Lead enrichment',
  'Ticket triage',
  'Invoice matching',
  'Pipeline report',
] as const

/** The grid's cell chrome, copied from the landing Tables preview vocabulary. */
const CELL = 'border-[var(--border)] border-r border-b px-2 py-[7px] align-middle select-none'
const CELL_CHECKBOX =
  'border-[var(--border)] border-r border-b px-1 py-[7px] align-middle select-none'
const CELL_HEADER =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] p-0 text-left align-middle'
const CELL_HEADER_CHECKBOX =
  'border-[var(--border)] border-r border-b bg-[var(--bg)] px-1 py-[7px] text-center align-middle'
const CELL_CONTENT =
  'relative min-h-[20px] min-w-0 overflow-clip text-ellipsis whitespace-nowrap text-small'

interface GridColumn {
  /** Stable key into each row's cell record. */
  id: 'name' | 'company' | 'email' | 'phone' | 'qualified'
  /** Column header label. */
  label: string
  /** Column type icon - text or boolean, per the real editor's headers. */
  type: 'text' | 'boolean'
  /** Fixed pixel width in the 1280-wide design space. */
  width: number
}

/**
 * The Leads table's schema: identity columns the agent writes on intake
 * (Name, Company) and the columns enrichments fill afterwards (Work email,
 * Phone, Qualified).
 */
const GRID_COLUMNS: readonly GridColumn[] = [
  { id: 'name', label: 'Name', type: 'text', width: 200 },
  { id: 'company', label: 'Company', type: 'text', width: 190 },
  { id: 'email', label: 'Work email', type: 'text', width: 240 },
  { id: 'phone', label: 'Phone', type: 'text', width: 170 },
  { id: 'qualified', label: 'Qualified', type: 'boolean', width: 110 },
] as const

/** Column ids the enrichment sweep fills, in sweep order (column-major). */
const ENRICHED_COLUMNS: readonly GridColumn['id'][] = ['email', 'phone', 'qualified']

interface LeadRow {
  /** Every cell value; `qualified` holds `'true'`/`'false'`. */
  cells: Record<GridColumn['id'], string>
}

/** Settled records already in the table when the loop opens. */
const BASE_ROWS: readonly LeadRow[] = [
  {
    cells: {
      name: 'Alice Johnson',
      company: 'Acme Corp',
      email: 'alice@acme.com',
      phone: '+1 (415) 555-0132',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Bob Williams',
      company: 'TechCo',
      email: 'bob@techco.io',
      phone: '+1 (206) 555-0119',
      qualified: 'false',
    },
  },
  {
    cells: {
      name: 'Carol Davis',
      company: 'StartupCo',
      email: 'carol@startup.co',
      phone: '+1 (512) 555-0177',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Dan Miller',
      company: 'BigCorp',
      email: 'dan@bigcorp.com',
      phone: '+1 (312) 555-0140',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Eva Chen',
      company: 'Design IO',
      email: 'eva@design.io',
      phone: '+1 (646) 555-0102',
      qualified: 'false',
    },
  },
  {
    cells: {
      name: 'Frank Lee',
      company: 'Ventures',
      email: 'frank@ventures.co',
      phone: '+1 (628) 555-0163',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Grace Kim',
      company: 'Northbeam',
      email: 'grace@northbeam.ai',
      phone: '+1 (917) 555-0181',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Henry Osei',
      company: 'Atlas Freight',
      email: 'henry@atlasfreight.com',
      phone: '+1 (773) 555-0155',
      qualified: 'false',
    },
  },
  {
    cells: {
      name: 'Ivy Patel',
      company: 'Lumen Labs',
      email: 'ivy@lumenlabs.dev',
      phone: '+1 (408) 555-0126',
      qualified: 'true',
    },
  },
] as const

/**
 * Records the intake agent appends during the loop - they land with only the
 * identity columns filled, then the enrichment sweep completes them.
 */
const APPENDED_ROWS: readonly LeadRow[] = [
  {
    cells: {
      name: 'Jonas Weber',
      company: 'Brightside',
      email: 'jonas@brightside.io',
      phone: '+1 (303) 555-0148',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Kara Novak',
      company: 'Fieldstone',
      email: 'kara@fieldstone.co',
      phone: '+1 (215) 555-0193',
      qualified: 'false',
    },
  },
  {
    cells: {
      name: 'Liam Byrne',
      company: 'Harborline',
      email: 'liam@harborline.com',
      phone: '+1 (617) 555-0171',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Mia Torres',
      company: 'Skylark',
      email: 'mia@skylark.app',
      phone: '+1 (702) 555-0117',
      qualified: 'true',
    },
  },
  {
    cells: {
      name: 'Noah Brandt',
      company: 'Coastal Supply',
      email: 'noah@coastalsupply.com',
      phone: '+1 (858) 555-0139',
      qualified: 'false',
    },
  },
] as const

/** Total enriched cells the sweep fills - one per enriched column per appended row. */
const TOTAL_FILLED_CELLS = APPENDED_ROWS.length * ENRICHED_COLUMNS.length

/** The settled grid holds this long before the first appended row lands. */
const IDLE_HOLD_MS = 900
/** Appended row N stamps in at IDLE_HOLD_MS + N * ROW_STEP_MS. */
const ROW_STEP_MS = 550
/** The enrichment sweep starts this long after the last row lands. */
const ENRICH_AFTER_MS = 600
/** One enriched cell fills every this many ms, column by column. */
const CELL_STEP_MS = 170
/** The fully enriched grid holds this long before the fade. */
const FILLED_HOLD_MS = 4200
/** Fade-out length before the cycle restarts. */
const RESET_FADE_MS = 300

interface TablesGridPaneProps {
  /** How many appended rows are on the grid (0..APPENDED_ROWS.length). */
  rowCount: number
  /** How many enriched cells the sweep has filled (0..TOTAL_FILLED_CELLS). */
  filledCount: number
}

/**
 * The static Tables editor pane in the landing Tables preview's exact
 * vocabulary - breadcrumb header, typed column headers, numbered rows -
 * rendered from the parent clock's `rowCount`/`filledCount` beats. The
 * enrichment sweep fills column-major (all Work emails, then Phones, then
 * Qualified), so it reads as an enrichment running per column.
 */
function TablesGridPane({ rowCount, filledCount }: TablesGridPaneProps) {
  const cellFilled = (appendedIndex: number, columnId: GridColumn['id']) => {
    const sweepColumn = ENRICHED_COLUMNS.indexOf(columnId)
    if (sweepColumn === -1) return true
    return sweepColumn * APPENDED_ROWS.length + appendedIndex < filledCount
  }

  const renderValue = (column: GridColumn, value: string, animate: boolean) => {
    const content =
      column.type === 'boolean' ? (
        <div className='flex min-h-[20px] items-center justify-center'>
          <Checkbox
            size='sm'
            checked={value === 'true'}
            aria-label={column.label}
            className='pointer-events-none'
          />
        </div>
      ) : (
        value
      )
    if (!animate) return content
    return <span className={cn('block', styles.cellIn)}>{content}</span>
  }

  const renderRow = (row: LeadRow, rowIndex: number, appendedIndex: number | null) => (
    <tr key={row.cells.name} className={cn(appendedIndex !== null && styles.rowIn)}>
      <td className={cn(CELL_CHECKBOX, 'text-center')}>
        <span className='text-[var(--text-muted)] text-xs tabular-nums'>{rowIndex + 1}</span>
      </td>
      {GRID_COLUMNS.map((column) => {
        const filled = appendedIndex === null || cellFilled(appendedIndex, column.id)
        const animate = appendedIndex !== null && ENRICHED_COLUMNS.includes(column.id)
        return (
          <td key={column.id} className={cn(CELL, 'text-[var(--text-body)]')}>
            <div className={CELL_CONTENT}>
              {filled ? renderValue(column, row.cells[column.id], animate && filled) : null}
            </div>
          </td>
        )
      })}
    </tr>
  )

  return (
    <div className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='border-[var(--border)] border-b px-4 py-[8.5px]'>
        <div className='flex items-center gap-3'>
          <span className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-secondary)] text-sm'>
            <Table className='mr-3 size-[14px] text-[var(--text-icon)]' />
            Tables
          </span>
          <span className='select-none text-[var(--text-icon)] text-sm'>/</span>
          <span className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-body)] text-sm'>
            Leads
            <ChevronDown className='ml-2 h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
          </span>
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-hidden'>
        <table className='table-fixed border-separate border-spacing-0 text-small'>
          <colgroup>
            <col style={{ width: 40 }} />
            {GRID_COLUMNS.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={CELL_HEADER_CHECKBOX} aria-label='Row number' />
              {GRID_COLUMNS.map((column) => {
                const Icon = column.type === 'boolean' ? TypeBoolean : TypeText
                return (
                  <th key={column.id} className={CELL_HEADER}>
                    <div className='flex h-full w-full min-w-0 items-center px-2 py-[7px]'>
                      <Icon className='size-3 shrink-0 text-[var(--text-icon)]' />
                      <span className='ml-1.5 min-w-0 overflow-clip text-ellipsis whitespace-nowrap font-medium text-[var(--text-primary)] text-small'>
                        {column.label}
                      </span>
                      <ChevronDown className='ml-auto h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {BASE_ROWS.map((row, index) => renderRow(row, index, null))}
            {APPENDED_ROWS.slice(0, rowCount).map((row, index) =>
              renderRow(row, BASE_ROWS.length + index, index)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The tables hero's editor loop - the grid-pane sibling of the workflows
 * editor loop. Same architecture (fixed 1280x735 design-space layer scaled
 * to the window via ResizeObserver + `transform: scale`, a parent-owned
 * clock driving a presentational pane, reduced-motion showing the finished
 * frame) and the same live {@link EnterpriseSidebar} with its Tables nav
 * row highlighted, but the workspace pane is the Leads table itself: the
 * intake agent appends five new records (identity columns only), then the
 * enrichment sweep fills the empty Work email, Phone, and Qualified cells
 * column by column, the grid holds fully enriched, and the scene fades
 * before the cycle restarts.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never
 * starts: the fully appended, fully enriched grid renders statically
 * (including reacting to media-query changes).
 */
export function TablesHeroLoop() {
  const regionRef = useRef<HTMLDivElement>(null)
  const [rowCount, setRowCount] = useState(0)
  const [filledCount, setFilledCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)
  const [scale, setScale] = useState(1)

  // Track the rendered region width and scale the design-space layer to fill
  // it, keeping the live layer's proportions locked to the window's.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 40) setScale(w / DESIGN.width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timers: ReturnType<typeof setTimeout>[] = []

    const clearScheduled = () => {
      timers.forEach(clearTimeout)
      timers = []
    }

    const showFinished = () => {
      clearScheduled()
      setFading(false)
      setRowCount(APPENDED_ROWS.length)
      setFilledCount(TOTAL_FILLED_CELLS)
    }

    const runCycle = () => {
      setFading(false)
      setRowCount(0)
      setFilledCount(0)
      setCycleId((c) => c + 1)
      const sweepAt = IDLE_HOLD_MS + (APPENDED_ROWS.length - 1) * ROW_STEP_MS + ENRICH_AFTER_MS
      const total = sweepAt + TOTAL_FILLED_CELLS * CELL_STEP_MS + FILLED_HOLD_MS
      timers = [
        ...APPENDED_ROWS.map((_, i) =>
          setTimeout(() => setRowCount(i + 1), IDLE_HOLD_MS + i * ROW_STEP_MS)
        ),
        ...Array.from({ length: TOTAL_FILLED_CELLS }, (_, i) =>
          setTimeout(() => setFilledCount(i + 1), sweepAt + i * CELL_STEP_MS)
        ),
        setTimeout(() => setFading(true), total - RESET_FADE_MS),
        setTimeout(runCycle, total),
      ]
    }

    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showFinished()
        return
      }
      runCycle()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, [])

  return (
    <div ref={regionRef} className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div
        className='flex origin-top-left bg-[var(--surface-1)]'
        style={{
          width: DESIGN.width,
          height: DESIGN.height,
          transform: `scale(${scale})`,
        }}
      >
        <EnterpriseSidebar
          workspaceName='Brightwave'
          chats={SIDEBAR_CHATS}
          workflows={SIDEBAR_WORKFLOWS}
          activeNav='Tables'
        />
        <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>
          <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
            <div
              className={cn(
                'h-full w-full transition-opacity duration-300 ease-out',
                fading ? 'opacity-0' : 'opacity-100'
              )}
            >
              <TablesGridPane key={cycleId} rowCount={rowCount} filledCount={filledCount} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
