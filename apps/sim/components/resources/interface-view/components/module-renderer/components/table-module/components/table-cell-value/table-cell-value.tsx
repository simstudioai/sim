'use client'

import { Checkbox } from '@sim/emcn'
import { parse } from 'tldts'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { formatDateCellDisplay } from '@/lib/table/dates'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

/**
 * How one cell should be drawn. Mirrors the plain-typed arm of the tables
 * grid's own `CellRenderKind` — the workflow-output arm (running, queued,
 * errored, waiting, not-found) is deliberately absent: a module renders a
 * table's stored values, never a live run's per-block state.
 */
type CellKind =
  | { kind: 'empty' }
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'json'; text: string }
  | { kind: 'date'; text: string }
  | { kind: 'url'; text: string; href: string; domain: string }
  | { kind: 'text'; text: string }

/** Bare `example.com` with no scheme — promoted to a link when it is a real TLD. */
const BARE_DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

function stringifyValue(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/** The link a string cell resolves to, or `null` when it is ordinary text. */
function extractUrlInfo(text: string): { href: string; domain: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      return { href: trimmed, domain: url.hostname }
    } catch {
      return null
    }
  }
  if (BARE_DOMAIN_RE.test(trimmed)) {
    const parsed = parse(trimmed)
    if (!parsed.isIcann) return null
    return { href: `https://${trimmed}`, domain: trimmed }
  }
  return null
}

/**
 * Picks the appearance for one stored value, following the same order the
 * tables grid uses: booleans before the null check (an unset boolean is a real
 * `false`), then null, then the column's declared type, with strings promoted
 * to links when the whole value is one.
 */
function resolveCellKind(value: JsonValue | undefined, column: ColumnDefinition): CellKind {
  if (column.type === 'boolean') return { kind: 'boolean', checked: Boolean(value) }
  if (value === null || value === undefined) return { kind: 'empty' }
  if (column.type === 'json') return { kind: 'json', text: JSON.stringify(value) }
  if (column.type === 'date') return { kind: 'date', text: String(value) }

  const text = stringifyValue(value)
  if (text === '') return { kind: 'empty' }
  if (column.type === 'string') {
    const url = extractUrlInfo(text)
    if (url) return { kind: 'url', text, href: url.href, domain: url.domain }
  }
  return { kind: 'text', text }
}

export interface TableCellValueProps {
  value: JsonValue | undefined
  column: ColumnDefinition
}

/**
 * One table cell as the interface module draws it.
 *
 * A deliberate approximation of the tables grid's own cell renderer, not a
 * fork with ambitions: it covers the appearances a stored value can take —
 * boolean checkbox, favicon'd link, formatted date, JSON, text — and stops
 * there. The real renderer additionally handles live workflow-output state and
 * in-workspace resource chips, both of which need the tables route tree
 * (`StatusBadge`, `SimResourceCell`) that a module mounted on an anonymous
 * share page cannot import.
 *
 * The end state is the tables feature owning one renderer both surfaces mount;
 * until that extraction happens, this keeps the two visually close rather than
 * leaving the module showing raw `String(value)` for every type.
 *
 * `min-h-[20px]` on every appearance is what keeps rows the same height —
 * without it a row whose cells are all empty collapses to its padding and the
 * table's rhythm breaks.
 */
export function TableCellValue({ value, column }: TableCellValueProps) {
  const kind = resolveCellKind(value, column)

  switch (kind.kind) {
    case 'empty':
      return <span className='block min-h-[20px]' />

    case 'boolean':
      return (
        <span className='flex min-h-[20px] items-center'>
          <Checkbox size='sm' checked={kind.checked} className='pointer-events-none' />
        </span>
      )

    case 'url':
      return (
        <span className='flex min-h-[20px] min-w-0 items-center gap-1.5'>
          <img
            src={faviconUrl(kind.domain, 16)}
            alt=''
            width={12}
            height={12}
            className='shrink-0 rounded-[2px]'
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
          <a
            href={kind.href}
            target='_blank'
            rel='noopener noreferrer'
            className='min-w-0 truncate text-[var(--text-primary)] underline underline-offset-2 transition-colors hover-hover:text-[var(--text-secondary)]'
          >
            {kind.text}
          </a>
        </span>
      )

    case 'date':
      return (
        <span className='block min-h-[20px] truncate text-[var(--text-primary)]'>
          {formatDateCellDisplay(kind.text, { seconds: true })}
        </span>
      )

    case 'json':
    case 'text':
      return (
        <span className='block min-h-[20px] truncate text-[var(--text-primary)]'>{kind.text}</span>
      )

    default:
      return null
  }
}
