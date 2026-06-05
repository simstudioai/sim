'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { parse } from 'tldts'
import { Badge, Checkbox, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { RowExecutionMetadata } from '@/lib/table'
import { StatusBadge } from '@/app/workspace/[workspaceId]/logs/utils'
import { storageToDisplay } from '../../../utils'
import type { DisplayColumn } from '../types'
import { SimResourceCell, type SimResourceType } from './sim-resource-cell'

export type CellRenderKind =
  // Workflow-output cells
  | { kind: 'value'; text: string }
  | { kind: 'block-error' }
  | { kind: 'running' }
  | { kind: 'pending-upstream' }
  | { kind: 'queued' }
  | { kind: 'cancelled' }
  | { kind: 'error' }
  | { kind: 'waiting'; labels: string[] }
  | { kind: 'not-found' }
  | { kind: 'no-output' }
  // Plain typed cells
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'json'; text: string }
  | { kind: 'date'; text: string }
  | { kind: 'url'; text: string; href: string; domain: string }
  | {
      kind: 'sim-resource'
      workspaceId: string
      resourceType: SimResourceType
      resourceId: string
      href: string
    }
  | { kind: 'text'; text: string }
  // Universal fallback
  | { kind: 'empty' }

interface ResolveCellRenderInput {
  value: unknown
  exec: RowExecutionMetadata | undefined
  column: DisplayColumn
  waitingOnLabels: string[] | undefined
  /** Column is an enrichment-group output — a completed-but-empty cell renders
   *  "Not found" rather than a blank, since the enrichment ran and matched nothing. */
  isEnrichmentOutput?: boolean
  /** Current workspace id — a URL pointing to a resource in this workspace
   *  renders as a tagged-resource chip rather than a plain external link. */
  currentWorkspaceId?: string
}

export function resolveCellRender({
  value,
  exec,
  column,
  waitingOnLabels,
  isEnrichmentOutput,
  currentWorkspaceId,
}: ResolveCellRenderInput): CellRenderKind {
  const isNull = value === null || value === undefined
  const isEmpty = isNull || value === ''

  if (column.workflowGroupId) {
    const blockId = column.outputBlockId
    const blockError = blockId ? exec?.blockErrors?.[blockId] : undefined
    const blockRunning = blockId ? (exec?.runningBlockIds?.includes(blockId) ?? false) : false
    const groupHasBlockErrors = !!(exec?.blockErrors && Object.keys(exec.blockErrors).length > 0)

    if (blockError) return { kind: 'block-error' }

    const inFlight =
      exec?.status === 'running' || exec?.status === 'queued' || exec?.status === 'pending'
    if (inFlight && blockRunning) return { kind: 'running' }

    // Value wins over pending-upstream: a finished column stays finished even
    // while other blocks in the group are still running. An empty string is not
    // a value — it falls through so a completed enrichment can show "Not found".
    // A value that's wholly a resource/URL string renders as a chip/link (any
    // column type — workflow output is free-form); otherwise the plain `value`
    // kind keeps the typewriter reveal for streaming text.
    if (!isEmpty) {
      const text = stringifyValue(value)
      return resolveLinkKind(text, currentWorkspaceId) ?? { kind: 'value', text }
    }

    if (inFlight && !(groupHasBlockErrors && !blockRunning)) {
      // A `pending` cell whose jobId starts with `paused-` is mid-pause
      // (workflow yielded for human-in-the-loop). Render as Pending rather
      // than Queued so the user can tell it's not just waiting to start.
      const isPaused =
        exec?.status === 'pending' &&
        typeof exec.jobId === 'string' &&
        exec.jobId.startsWith('paused-')
      if (isPaused) return { kind: 'pending-upstream' }
      if (exec?.status === 'queued' || exec?.status === 'pending') return { kind: 'queued' }
      return { kind: 'pending-upstream' }
    }

    // Waiting wins over a stale terminal status — show the actionable state.
    if (waitingOnLabels && waitingOnLabels.length > 0) {
      return { kind: 'waiting', labels: waitingOnLabels }
    }
    if (exec?.status === 'cancelled') return { kind: 'cancelled' }
    if (exec?.status === 'error') return { kind: 'error' }
    // Enrichment ran to completion but matched nothing → "Not found".
    if (isEnrichmentOutput && exec?.status === 'completed') return { kind: 'not-found' }
    // Workflow output: the group's run completed but this block produced no
    // value for the cell → grey "No output" (distinct from a never-run blank).
    if (exec?.status === 'completed') return { kind: 'no-output' }
    return { kind: 'empty' }
  }

  if (column.type === 'boolean') return { kind: 'boolean', checked: Boolean(value) }
  if (isNull) return { kind: 'empty' }
  if (column.type === 'json') return { kind: 'json', text: JSON.stringify(value) }
  if (column.type === 'date') return { kind: 'date', text: String(value) }
  if (column.type === 'string') {
    const text = stringifyValue(value)
    return resolveLinkKind(text, currentWorkspaceId) ?? { kind: 'text', text }
  }
  return { kind: 'text', text: stringifyValue(value) }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/** Returns a `sim-resource` cell kind when `text` is a URL pointing to a
 *  resource in the current workspace, else null. Shared by plain string cells
 *  and workflow-output value cells so both surface in-workspace resource links
 *  as tagged chips. */
function resolveSimResourceKind(
  text: string,
  currentWorkspaceId: string | undefined
): Extract<CellRenderKind, { kind: 'sim-resource' }> | null {
  if (!currentWorkspaceId) return null
  const resource = extractSimResourceInfo(text)
  if (!resource || resource.workspaceId !== currentWorkspaceId) return null
  return {
    kind: 'sim-resource',
    workspaceId: resource.workspaceId,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    href: resource.href,
  }
}

/**
 * Promotes a cell value that is wholly a resource/URL string to a chip
 * (in-workspace resource) or a favicon link, else null. Shared by plain string
 * cells and workflow-output value cells. Workflow outputs apply this regardless
 * of `column.type` (their type defaults to `json`, so gating on `string` would
 * miss URL outputs); a stringified object never matches the whole-string URL
 * check, so it stays JSON/text.
 */
function resolveLinkKind(
  text: string,
  currentWorkspaceId: string | undefined
): Extract<CellRenderKind, { kind: 'sim-resource' } | { kind: 'url' }> | null {
  const simKind = resolveSimResourceKind(text, currentWorkspaceId)
  if (simKind) return simKind
  const urlInfo = extractUrlInfo(text)
  if (urlInfo) return { kind: 'url', text, href: urlInfo.href, domain: urlInfo.domain }
  return null
}

const BARE_DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/

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

/** Maps a workspace route section to the sim resource kind it addresses. */
const SIM_RESOURCE_SECTIONS: Record<string, SimResourceType> = {
  w: 'workflow',
  tables: 'table',
  knowledge: 'knowledge',
  files: 'file',
}

/**
 * Recognizes a `/workspace/{id}/{section}/{resourceId}` URL (absolute or
 * relative) pointing to a sim resource and returns its descriptor. The href is
 * the pathname so the link stays within the current deployment. Returns null
 * for anything that isn't a single-segment resource route.
 */
function extractSimResourceInfo(
  text: string
): { workspaceId: string; resourceType: SimResourceType; resourceId: string; href: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let pathname: string
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname
    } catch {
      return null
    }
  } else if (trimmed.startsWith('/')) {
    pathname = trimmed.split(/[?#]/)[0]
  } else {
    return null
  }
  const match = pathname.match(/^\/workspace\/([^/]+)\/(w|tables|knowledge|files)\/([^/]+)\/?$/)
  if (!match) return null
  const [, workspaceId, section, resourceId] = match
  return { workspaceId, resourceType: SIM_RESOURCE_SECTIONS[section], resourceId, href: pathname }
}

interface CellRenderProps {
  kind: CellRenderKind
  isEditing: boolean
}

export function CellRender({ kind, isEditing }: CellRenderProps): React.ReactElement | null {
  const valueText = kind.kind === 'value' ? kind.text : null
  const revealedValueText = useTypewriter(valueText)

  switch (kind.kind) {
    case 'value':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {revealedValueText ?? kind.text}
        </span>
      )

    case 'block-error':
    case 'error':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='error' />
        </Wrap>
      )

    case 'running':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='running' />
        </Wrap>
      )

    case 'pending-upstream':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='pending' />
        </Wrap>
      )

    case 'cancelled':
      return (
        <Wrap isEditing={isEditing}>
          <StatusBadge status='cancelled' />
        </Wrap>
      )

    case 'queued':
      return (
        <Wrap isEditing={isEditing}>
          <Badge variant='gray' dot size='sm'>
            Queued
          </Badge>
        </Wrap>
      )

    case 'waiting':
      return (
        <Wrap isEditing={isEditing}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span>
                <Badge variant='gray' dot size='sm'>
                  Waiting
                </Badge>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              Waiting on {kind.labels.map((l) => `"${l}"`).join(', ')}
            </Tooltip.Content>
          </Tooltip.Root>
        </Wrap>
      )

    case 'boolean':
      return (
        <div
          data-boolean-cell-toggle
          className={cn(
            'flex min-h-[20px] w-full items-center justify-center',
            isEditing && 'invisible'
          )}
        >
          <Checkbox size='sm' checked={kind.checked} className='pointer-events-none' />
        </div>
      )

    case 'json':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {kind.text}
        </span>
      )

    case 'date':
      return (
        <span className={cn('text-[var(--text-primary)]', isEditing && 'invisible')}>
          {storageToDisplay(kind.text)}
        </span>
      )

    case 'url':
      return (
        <span className={cn('flex min-w-0 items-center gap-1.5', isEditing && 'invisible')}>
          <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(kind.domain)}&sz=16`}
            alt=''
            width={12}
            height={12}
            className='shrink-0 rounded-[2px]'
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <a
            href={kind.href}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
              'min-w-0 overflow-clip text-ellipsis text-[var(--text-primary)] underline underline-offset-2 transition-colors hover-hover:text-[var(--text-secondary)]',
              isEditing && 'pointer-events-none'
            )}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {kind.text}
          </a>
        </span>
      )

    case 'sim-resource':
      return (
        <SimResourceCell
          workspaceId={kind.workspaceId}
          resourceType={kind.resourceType}
          resourceId={kind.resourceId}
          href={kind.href}
          isEditing={isEditing}
        />
      )

    case 'text':
      return (
        <span
          className={cn(
            'block overflow-clip text-ellipsis text-[var(--text-primary)]',
            isEditing && 'invisible'
          )}
        >
          {kind.text}
        </span>
      )

    case 'not-found':
      return (
        <Wrap isEditing={isEditing}>
          <Badge variant='gray' dot size='sm'>
            Not found
          </Badge>
        </Wrap>
      )

    case 'no-output':
      return (
        <Wrap isEditing={isEditing}>
          <Badge variant='gray' dot size='sm'>
            No output
          </Badge>
        </Wrap>
      )

    case 'empty':
      return null

    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function Wrap({ isEditing, children }: { isEditing: boolean; children: React.ReactNode }) {
  if (!isEditing) return <>{children}</>
  return <div className='invisible'>{children}</div>
}

const TYPEWRITER_MS_PER_CHAR = 15

/**
 * Reveals `text` character-by-character when it changes after the first render;
 * the initial render (mount / scroll-in) shows it statically. The slice is
 * derived from elapsed time during render rather than held in state, so it is
 * never `null` and never the full string on the frame `text` changes — which is
 * what prevents the caller's `?? kind.text` fallback from flashing the whole
 * value for a frame. `prevText` is state (not a ref) so a discarded render rolls
 * it back and re-detects the change on the committed render.
 */
function useTypewriter(text: string | null): string | null {
  const [prevText, setPrevText] = useState<string | null>(text)
  const [, forceFrame] = useState(0)
  const mountedRef = useRef(false)
  // Reveal-clock start; 0 = show statically (mount / cleared / empty).
  const startRef = useRef(0)

  if (prevText !== text) {
    setPrevText(text)
    startRef.current =
      mountedRef.current && text !== null && text.length > 0 ? performance.now() : 0
  }

  useEffect(() => {
    mountedRef.current = true
  }, [])

  useEffect(() => {
    if (startRef.current === 0 || text === null) return
    let raf = 0
    const tick = () => {
      const chars = Math.floor((performance.now() - startRef.current) / TYPEWRITER_MS_PER_CHAR)
      forceFrame((f) => f + 1)
      if (chars < text.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text])

  if (text === null) return null
  if (startRef.current === 0) return text
  const chars = Math.min(
    text.length,
    Math.floor((performance.now() - startRef.current) / TYPEWRITER_MS_PER_CHAR)
  )
  return text.slice(0, chars)
}
