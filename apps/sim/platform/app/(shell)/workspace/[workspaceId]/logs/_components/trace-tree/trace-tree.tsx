'use client'

import { type KeyboardEvent, useState } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { formatDuration } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { TraceSpan } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/trace-tree/trace-tree.module.css'

const KIND_ICON: Record<TraceSpan['kind'], IconName> = {
  agent: 'I128',
  model: 'I128',
  tool: 'I127',
  mcp: 'I126',
  loop: 'I130',
  iteration: 'I130',
  parallel: 'I129',
  branch: 'I129',
  workflow: 'I118',
  block: 'I127',
}

const PROVIDER_ICON: Partial<Record<string, IconName>> = { slack: 'I123', openai: 'I124' }
/** Providers whose own mark the shared icon catalog carries. */
const PROVIDER_MARKS = new Set(['salesforce', 'notion', 'github', 'linear', 'jira', 'hubspot'])

/** A span's timing paint, from its recorded family and provider; failures take precedence. */
function spanPaint(span: TraceSpan) {
  if (span.status === 'error') return 'error'
  if (span.status === 'handled') return 'handled'
  if (span.providerId === 'slack') return 'slack'
  if (span.providerId === 'anthropic') return 'anthropic'
  if (span.providerId === 'openai') return 'neutral'
  switch (span.kind) {
    case 'agent':
      return 'agent'
    case 'loop':
      return 'loop'
    case 'iteration':
      return 'iteration'
    case 'parallel':
      return 'parallel'
    case 'workflow':
      return 'workflow'
    case 'mcp':
      return 'mcp'
    default:
      return 'neutral'
  }
}

function SpanMark({ span }: { span: TraceSpan }) {
  const providerIcon = span.providerId ? PROVIDER_ICON[span.providerId] : undefined
  if (providerIcon) return <Icon name={providerIcon} />
  if (span.providerId && PROVIDER_MARKS.has(span.providerId))
    return <Icon providerId={span.providerId} />
  return <Icon name={KIND_ICON[span.kind]} />
}

interface VisibleSpan {
  span: TraceSpan
  depth: number
}

function visibleSpans(
  spans: readonly TraceSpan[],
  collapsed: ReadonlySet<string>,
  depth = 0
): VisibleSpan[] {
  return spans.flatMap((span) => [
    { span, depth },
    ...(span.children?.length && !collapsed.has(span.id)
      ? visibleSpans(span.children, collapsed, depth + 1)
      : []),
  ])
}

interface TraceTreeProps {
  label: string
  trace: readonly TraceSpan[]
  /** The root's duration: every bar is placed on this one clock. */
  totalMs: number
  selectedId: string
  onSelect: (id: string) => void
}

/**
 * The run's steps as a tree on one clock: nesting by indent, each step's mark and duration, and a
 * bar placed where it ran. Selecting a step opens it below; Left and Right collapse and expand.
 */
export function TraceTree({ label, trace, totalMs, selectedId, onSelect }: TraceTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const rows = visibleSpans(trace, collapsed)
  const clock = Math.max(1, totalMs)
  const share = (ms: number) => Math.max(0, Math.min(100, (100 * ms) / clock))

  function toggle(id: string, open?: boolean) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (open ?? next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, span: TraceSpan) {
    const list = event.currentTarget.closest('ol')
    const targets = [...(list?.querySelectorAll<HTMLButtonElement>('[data-trace-target]') ?? [])]
    const index = targets.indexOf(event.currentTarget)
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: targets.length - 1 }[
      event.key
    ]
    if (move !== undefined && targets[move]) {
      event.preventDefault()
      targets[move].focus()
      return
    }
    if (span.children?.length && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      toggle(span.id, event.key === 'ArrowRight')
    }
  }

  return (
    <ol className={styles.tree} aria-label={label}>
      {rows.map(({ span, depth }) => {
        const expandable = Boolean(span.children?.length)
        const open = expandable && !collapsed.has(span.id)
        const start = share(span.startMs)
        return (
          <li
            key={span.id}
            className={styles.row}
            data-selected={span.id === selectedId || undefined}
          >
            {Array.from({ length: depth }, (_, level) => (
              <span key={level} className={styles.indent} aria-hidden='true' />
            ))}
            {expandable ? (
              <button
                type='button'
                className={styles.disclosure}
                aria-label={`${open ? 'Collapse' : 'Expand'} ${span.name}`}
                aria-expanded={open}
                onClick={() => toggle(span.id)}
              >
                <Icon name={open ? 'I051' : 'I090'} />
              </button>
            ) : (
              <span className={styles.disclosure} aria-hidden='true' />
            )}
            <button
              type='button'
              className={styles.target}
              data-trace-target=''
              aria-pressed={span.id === selectedId}
              onClick={() => onSelect(span.id)}
              onKeyDown={(event) => onKeyDown(event, span)}
            >
              <span className={styles.mark} aria-hidden='true'>
                {depth > 0 && <SpanMark span={span} />}
              </span>
              <span className={styles.name} data-type='T060'>
                <OverflowText text={span.name}>{span.name}</OverflowText>
              </span>
              <span className={styles.duration} data-type='T052'>
                {formatDuration(span.durationMs)}
              </span>
              <svg
                className={styles.timeline}
                role='img'
                aria-label={`Started at ${formatDuration(span.startMs)}`}
              >
                <rect className={styles.track} x='0' y='2.5' width='100%' height='1' />
                <rect
                  className={styles.bar}
                  data-paint={spanPaint(span)}
                  x={`${start}%`}
                  y='0'
                  width={`${Math.max(0.6, Math.min(100 - start, share(span.durationMs)))}%`}
                  height='100%'
                  rx='2'
                />
              </svg>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
