'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { InlineNotice } from '@sim/emcn/status'
import { escapeRegExp } from '@sim/utils/string'
import { FindBar } from '@/components/find-bar/find-bar'
import { MetadataFields } from '@/app/(product)/_components/workspace/metadata-fields/metadata-fields'
import styles from '@/app/(product)/_components/workspace/span-inspector/span-inspector.module.css'
import { formatDuration } from '@/app/(product)/_components/workspace/workspace-session/format'
import { useFindShortcut } from '@/platform/lib/data/find-shortcut'
import { useCodeViewerFeatures } from '@/platform/lib/data/workflow-deploy/terminal'
import type { TracePayload, TraceSpan } from '@/platform/shared/workspace-records'

const STEP_TYPE: Record<TraceSpan['kind'], string> = {
  agent: 'Agent',
  model: 'Model call',
  tool: 'Tool call',
  mcp: 'MCP tool call',
  loop: 'Loop',
  iteration: 'Loop iteration',
  parallel: 'Parallel',
  branch: 'Parallel branch',
  workflow: 'Workflow',
  block: 'Block',
}

const STEP_STATUS: Record<TraceSpan['status'], string> = {
  success: 'Succeeded',
  error: 'Failed',
  handled: 'Recovered',
  running: 'Running',
}

const FORMAT_LABEL = { json: 'JSON', text: 'Text' } as const

/** Lines a payload shows before the reader asks for the rest, so a large input never buries its output. */
const PREVIEW_LINES = 32

const NOTICE_INTENT = { neutral: 'neutral', warning: 'warning', danger: 'danger' } as const

/** A find in the step's payloads: the query, which match is current, and where the total goes. */
interface PayloadSearch {
  query: string
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
}

interface PayloadLine {
  number: number
  indent: string
  code: string
}

function toLines(content: string): PayloadLine[] {
  return content.split('\n').map((line, number) => {
    const code = line.trimStart()
    return { number, indent: line.slice(0, line.length - code.length), code }
  })
}

function searchPattern(query: string | undefined): RegExp | null {
  return query ? new RegExp(escapeRegExp(query), 'gi') : null
}

function countMatches(lines: readonly PayloadLine[], pattern: RegExp | null): number {
  if (!pattern) return 0
  return lines.reduce((total, line) => total + (line.code.match(pattern)?.length ?? 0), 0)
}

/** A line's text with each match marked, numbered from `first` across the step's payloads. */
function markMatches(code: string, pattern: RegExp | null, first: number, current: number) {
  if (!pattern) return code
  const parts: ReactNode[] = []
  let cursor = 0
  let index = first
  for (const match of code.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) parts.push(code.slice(cursor, start))
    parts.push(
      <mark key={start} data-search-match data-current={index === current || undefined}>
        {match[0]}
      </mark>
    )
    cursor = start + match[0].length
    index++
  }
  if (cursor < code.length) parts.push(code.slice(cursor))
  return parts
}

interface PayloadProps {
  label: string
  payload: TracePayload
  search?: { pattern: RegExp | null; first: number; current: number }
}

interface PayloadBodyProps {
  content: string
  search: PayloadProps['search']
}

/**
 * The content in the chat tool payload's monospace, one source line at a time so wrapped values keep
 * their indent. A long payload shows its first lines until the reader asks for all of them, or
 * searches it.
 */
function PayloadBody({ content, search }: PayloadBodyProps) {
  const [expanded, setExpanded] = useState(false)
  const lines = toLines(content)
  const pattern = search?.pattern ?? null
  const long = lines.length > PREVIEW_LINES && !pattern
  let next = search?.first ?? 0
  const marked = lines.map((line) => {
    const first = next
    next += pattern ? (line.code.match(pattern)?.length ?? 0) : 0
    return { ...line, first }
  })
  return (
    <>
      <pre className={styles.body} data-type='T009'>
        {(long && !expanded ? marked.slice(0, PREVIEW_LINES) : marked).map((line) => (
          <span key={line.number} className={styles.line}>
            <span className={styles.indent}>{line.indent}</span>
            <span className={styles.code}>
              {line.code ? markMatches(line.code, pattern, line.first, search?.current ?? -1) : ' '}
            </span>
          </span>
        ))}
      </pre>
      {long && (
        <span className={styles.more}>
          <Button variant='quiet' size='compact' onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${lines.length.toLocaleString('en-US')} lines`}
          </Button>
        </span>
      )}
    </>
  )
}

/**
 * Paper's trace payload: a caption with the format and a copy action above the content, which has
 * no surface of its own. Withheld content shows why in its place.
 */
export function Payload({ label, payload, search }: PayloadProps) {
  return (
    <section className={styles.payload} aria-label={label}>
      <header className={styles.payloadHeader}>
        <h3 data-type='T051'>{label}</h3>
        {payload.format !== 'withheld' && (
          <span className={styles.payloadActions}>
            <span data-type='T050'>{FORMAT_LABEL[payload.format]}</span>
            <CopyButton label={`Copy ${label.toLowerCase()}`} text={payload.content} />
          </span>
        )}
      </header>
      {payload.format === 'withheld' ? (
        <InlineNotice intent='neutral' title='Content withheld' message={payload.reason} />
      ) : (
        <PayloadBody content={payload.content} search={search} />
      )}
    </section>
  )
}

function shownContent(payload: TracePayload | undefined) {
  return payload && payload.format !== 'withheld' ? payload.content : ''
}

/** A payload a step carries beyond its input and output, such as a model's thinking. */
interface ExtraPayload {
  id: string
  label: string
  payload: TracePayload
}

interface SpanInspectorProps {
  span: TraceSpan
  /** Marks a find's matches in the input, the output, then each extra payload, and reports the total. */
  search?: PayloadSearch
  extraPayloads?: readonly ExtraPayload[]
}

/** The selected step: what it was, how it went, the context it ran in and what it read and wrote. */
export function SpanInspector({ span, search, extraPayloads = [] }: SpanInspectorProps) {
  const pattern = searchPattern(search?.query)
  const counts = [span.input, span.output, ...extraPayloads.map((extra) => extra.payload)].map(
    (payload) => countMatches(toLines(shownContent(payload)), pattern)
  )
  const firstMatch = (index: number) =>
    counts.slice(0, index).reduce((sum, count) => sum + count, 0)
  const total = firstMatch(counts.length)
  const report = search?.onMatchCountChange
  useEffect(() => {
    report?.(total)
  }, [report, total])
  const current = search?.currentMatchIndex ?? -1
  return (
    <section className={styles.inspector} aria-label={`${span.name} step`}>
      <h2 className={styles.heading} data-type='T093'>
        {span.name}
      </h2>
      <MetadataFields
        label={`${span.name} facts`}
        fields={[
          { id: 'type', label: 'Step type', value: STEP_TYPE[span.kind] },
          { id: 'status', label: 'Status', value: STEP_STATUS[span.status] },
          { id: 'duration', label: 'Duration', value: formatDuration(span.durationMs) },
          ...span.context,
        ]}
      />
      {span.notice && (
        <InlineNotice
          intent={NOTICE_INTENT[span.notice.tone]}
          title={span.notice.title}
          message={span.notice.message}
        />
      )}
      {span.input && (
        <Payload label='Input' payload={span.input} search={{ pattern, first: 0, current }} />
      )}
      {span.output && (
        <Payload
          label='Output'
          payload={span.output}
          search={{ pattern, first: firstMatch(1), current }}
        />
      )}
      {extraPayloads.map((extra, index) => (
        <Payload
          key={extra.id}
          label={extra.label}
          payload={extra.payload}
          search={{ pattern, first: firstMatch(index + 2), current }}
        />
      ))}
    </section>
  )
}

/**
 * The inspector with its own find: Cmd/Ctrl+F inside it opens a find bar over the step's payloads,
 * stepping through the matches it marks.
 */
export function FindableSpanInspector({ span, extraPayloads }: Omit<SpanInspectorProps, 'search'>) {
  const container = useRef<HTMLDivElement>(null)
  const find = useCodeViewerFeatures({ contentRef: container })
  const onKeyDown = useFindShortcut({
    enabled: true,
    inputRef: find.searchInputRef,
    containerRef: container,
    onOpen: find.activateSearch,
  })
  return (
    <div ref={container} className={styles.findable} onKeyDown={onKeyDown}>
      {find.isSearchActive && (
        <FindBar
          label='Find in step'
          query={find.searchQuery}
          onQueryChange={find.setSearchQuery}
          inputRef={find.searchInputRef}
          results={{ index: find.currentMatchIndex, count: find.matchCount }}
          onStep={(direction) =>
            direction === 1 ? find.goToNextMatch() : find.goToPreviousMatch()
          }
          onClose={find.closeSearch}
        />
      )}
      <SpanInspector
        span={span}
        extraPayloads={extraPayloads}
        search={
          find.isSearchActive
            ? {
                query: find.searchQuery,
                currentMatchIndex: find.currentMatchIndex,
                onMatchCountChange: find.handleMatchCountChange,
              }
            : undefined
        }
      />
    </div>
  )
}
