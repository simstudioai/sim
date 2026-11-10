'use client'

import { type ReactElement, useEffect, useReducer, useRef, useState } from 'react'
import { Checkbox } from '@sim/emcn/checkbox'
import { Icon } from '@sim/emcn/icon'
import { StatusTag, StatusText } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { LRUCache } from 'lru-cache'
import Link from 'next/link'
import { parse } from 'tldts'
import { workspacePath } from '@/lib/navigation/paths'
import { resolveSelectOptions } from '@/app/(product)/_components/workspace/tables/select-field/select-field'
import { InlineEditor } from '@/app/(product)/_components/workspace/tables/table-grid/inline-editors'
import styles from '@/app/(product)/_components/workspace/tables/table-grid/table-grid.module.css'
import { useKnowledgeBasesQuery } from '@/platform/lib/data/knowledge'
import {
  columnTypeOf,
  type DisplayColumn,
  faviconSrc,
  type RowExecutionMetadata,
  type SaveReason,
  type SelectOption,
  storageToDisplay,
  type TimezoneState,
  useTablesList,
  useWorkspaceFileLookup,
} from '@/platform/lib/data/tables'
import { useWorkflows } from '@/platform/lib/data/workflows/records'
import { usePlatformHref } from '@/platform/lib/navigation'

/** Workspace resources a cell URL can point to. */
type SimResourceType = 'workflow' | 'table' | 'knowledge' | 'file'

type CellRenderKind =
  // Workflow-output cells
  | { kind: 'value'; text: string }
  | { kind: 'block-error'; message: string }
  | { kind: 'running' }
  | { kind: 'pending-upstream'; paused: boolean }
  | { kind: 'queued' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string | null }
  | { kind: 'waiting'; labels: string[] }
  | { kind: 'not-found' }
  | { kind: 'no-output' }
  // Plain typed cells
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'select'; options: SelectOption[] }
  | { kind: 'json'; text: string }
  | { kind: 'date'; text: string; raw?: boolean }
  | { kind: 'url'; text: string; href: string; domain: string }
  | {
      kind: 'sim-resource'
      workspaceId: string
      resourceType: SimResourceType
      resourceId: string
    }
  | { kind: 'text'; text: string }
  // Universal fallback
  | { kind: 'empty' }

interface ResolveCellRenderInput {
  value: unknown
  exec: RowExecutionMetadata | undefined
  column: DisplayColumn
  waitingOnLabels: string[] | undefined
  /** An enrichment-group output: a completed-but-empty cell reads "Not found", since it ran and matched nothing. */
  isEnrichmentOutput?: boolean
  /** A URL pointing to a resource in this workspace renders as a resource chip, not an external link. */
  currentWorkspaceId?: string
  /** Invalid or unavailable preferences render time-based values without conversion. */
  timezoneStatus?: TimezoneState['status']
}

/** Maps a cell's value, column and run state to what it shows. Pure, so the row memo can trust it. */
function resolveCellRender({
  value,
  exec,
  column,
  waitingOnLabels,
  isEnrichmentOutput,
  currentWorkspaceId,
  timezoneStatus,
}: ResolveCellRenderInput): CellRenderKind {
  const isNull = value === null || value === undefined
  const isEmpty = isNull || value === ''

  if (column.workflowGroupId) {
    const blockId = column.outputBlockId
    const blockError = blockId ? exec?.blockErrors?.[blockId] : undefined
    const blockRunning = blockId ? (exec?.runningBlockIds?.includes(blockId) ?? false) : false
    const groupHasBlockErrors = !!(exec?.blockErrors && Object.keys(exec.blockErrors).length > 0)

    if (blockError) return { kind: 'block-error', message: blockError }

    const inFlight =
      exec?.status === 'running' || exec?.status === 'queued' || exec?.status === 'pending'
    if (inFlight && blockRunning) return { kind: 'running' }

    // A value wins over pending-upstream: a finished column stays finished while other blocks in
    // the group run. An empty string is not a value, so a completed enrichment can read "Not found".
    if (!isEmpty) {
      const text = stringifyValue(value)
      return resolveLinkKind(text, currentWorkspaceId) ?? { kind: 'value', text }
    }

    // Enrichment outputs share an empty blockId, so the group's `running` status is their only
    // "picked up" signal. Checked after the value so a rerun keeps the previous output on screen.
    if (isEnrichmentOutput && exec?.status === 'running') return { kind: 'running' }

    if (inFlight && !(groupHasBlockErrors && !blockRunning)) {
      // A pending cell whose job id starts with `paused-` is waiting on human input.
      const isPaused =
        exec?.status === 'pending' &&
        typeof exec.jobId === 'string' &&
        exec.jobId.startsWith('paused-')
      if (isPaused) return { kind: 'pending-upstream', paused: true }
      if (exec?.status === 'queued' || exec?.status === 'pending') return { kind: 'queued' }
      return { kind: 'pending-upstream', paused: false }
    }

    // Waiting wins over a stale terminal status: show the actionable state.
    if (waitingOnLabels && waitingOnLabels.length > 0) {
      return { kind: 'waiting', labels: waitingOnLabels }
    }
    if (exec?.status === 'cancelled') return { kind: 'cancelled' }
    if (exec?.status === 'error') return { kind: 'error', message: exec.error }
    if (isEnrichmentOutput && exec?.status === 'completed') return { kind: 'not-found' }
    // The run completed but this block produced nothing for the cell, unlike a never-run blank.
    if (exec?.status === 'completed') return { kind: 'no-output' }
    return { kind: 'empty' }
  }

  if (column.type === 'boolean') return { kind: 'boolean', checked: Boolean(value) }
  // Select cells always render as options, an empty one as a muted "None", so each reads as a picker.
  if (column.type === 'select') {
    return { kind: 'select', options: resolveSelectOptions(column, value) }
  }
  if (isNull) return { kind: 'empty' }
  // The symbol and fraction digits come from the column's currency.
  if (column.type === 'currency') {
    return { kind: 'text', text: columnTypeOf(column).formatForDisplay(value, column) }
  }
  if (column.type === 'json') return { kind: 'json', text: JSON.stringify(value) }
  const definition = columnTypeOf(column)
  if (definition.editor === 'date') {
    if (timezoneStatus !== undefined && timezoneStatus !== 'ready') {
      return { kind: 'date', text: stringifyValue(value), raw: true }
    }
    return { kind: 'date', text: definition.formatForInput(value, column) }
  }
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

/**
 * Promotes a value that is wholly a resource or URL string to a chip (a resource in this workspace)
 * or a favicon link, else null. Workflow outputs apply it whatever the column's type.
 */
function resolveLinkKind(
  text: string,
  currentWorkspaceId: string | undefined
): Extract<CellRenderKind, { kind: 'sim-resource' } | { kind: 'url' }> | null {
  if (currentWorkspaceId) {
    const resource = extractSimResourceInfo(text)
    if (resource && resource.workspaceId === currentWorkspaceId) {
      return { kind: 'sim-resource', ...resource }
    }
  }
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

/** A workspace route section and the resource kind it addresses. */
const SIM_RESOURCE_SECTIONS: Record<string, SimResourceType> = {
  w: 'workflow',
  workflows: 'workflow',
  tables: 'table',
  knowledge: 'knowledge',
  files: 'file',
}

/** Where each resource kind opens in this app. */
const RESOURCE_TAB: Record<SimResourceType, string> = {
  workflow: 'workflows',
  table: 'tables',
  knowledge: 'knowledge',
  file: 'files',
}

/**
 * Recognizes a `/workspace/{id}/{section}/{resourceId}` URL, absolute or relative, in either app's
 * route shape. Anything that is not a single-segment resource route returns null.
 */
function extractSimResourceInfo(
  text: string
): { workspaceId: string; resourceType: SimResourceType; resourceId: string } | null {
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
  const match = pathname.match(
    /\/workspace\/([^/]+)\/(w|workflows|tables|knowledge|files)\/([^/]+)\/?$/
  )
  if (!match) return null
  const [, workspaceId, section, resourceId] = match
  return { workspaceId, resourceType: SIM_RESOURCE_SECTIONS[section], resourceId }
}

interface CellContentProps {
  value: unknown
  exec?: RowExecutionMetadata
  column: DisplayColumn
  workspaceId: string
  timezoneStatus: TimezoneState['status']
  isEditing: boolean
  initialCharacter?: string | null
  /** Opens the inline editor read-only; text stays selectable and copyable. */
  readOnly?: boolean
  onSave: (value: unknown, reason: SaveReason) => void
  onCancel: () => void
  /** Unmet dependencies on this row and group, which render a "Waiting" tag. */
  waitingOnLabels?: string[]
  /** The column is an enrichment output: a completed-but-empty cell reads "Not found". */
  isEnrichmentOutput?: boolean
}

/** One cell's value, with the inline editor over it while the cell is being edited. */
export function CellContent({
  value,
  exec,
  column,
  workspaceId,
  timezoneStatus,
  isEditing,
  initialCharacter,
  readOnly,
  onSave,
  onCancel,
  waitingOnLabels,
  isEnrichmentOutput,
}: CellContentProps) {
  const kind = resolveCellRender({
    value,
    exec,
    column,
    waitingOnLabels,
    isEnrichmentOutput,
    currentWorkspaceId: workspaceId,
    timezoneStatus,
  })

  return (
    <>
      {isEditing && (
        <div className={styles.editorLayer}>
          <InlineEditor
            value={value}
            column={column}
            initialCharacter={initialCharacter ?? undefined}
            readOnly={readOnly}
            onSave={onSave}
            onCancel={onCancel}
          />
        </div>
      )}
      <CellRender kind={kind} isEditing={isEditing} />
    </>
  )
}

interface CellRenderProps {
  kind: CellRenderKind
  isEditing: boolean
}

function CellRender({ kind, isEditing }: CellRenderProps): ReactElement | null {
  const valueText = kind.kind === 'value' ? kind.text : null
  const revealedValueText = useTypewriter(valueText)
  const hidden = isEditing || undefined

  switch (kind.kind) {
    case 'value':
      return (
        <span className={styles.cellText} data-hidden={hidden}>
          {revealedValueText ?? kind.text}
        </span>
      )

    case 'block-error':
    case 'error':
      return (
        <StatusCell
          hidden={isEditing}
          label='Error'
          intent='danger'
          tip={kind.message ?? undefined}
        />
      )

    case 'running':
      return (
        <StatusCell
          hidden={isEditing}
          label='Running'
          intent='warning'
          tip='The block is running.'
        />
      )

    case 'pending-upstream':
      return (
        <StatusCell
          hidden={isEditing}
          label='Pending'
          intent='warning'
          tip={
            kind.paused
              ? 'Paused — waiting on input to resume.'
              : 'Waiting on an earlier block in this run.'
          }
        />
      )

    case 'cancelled':
      return (
        <StatusCell
          hidden={isEditing}
          label='Cancelled'
          intent='warning'
          tip='Stopped before finishing — re-run to retry.'
        />
      )

    case 'queued':
      return (
        <StatusCell
          hidden={isEditing}
          label='Queued'
          tip='In line to run — starts when a batch slot opens.'
        />
      )

    case 'waiting':
      return (
        <StatusCell
          hidden={isEditing}
          label='Waiting'
          tip={`Waiting on ${kind.labels.map((l) => `"${l}"`).join(', ')}`}
        />
      )

    case 'boolean':
      return (
        <span className={styles.booleanCell} data-boolean-cell-toggle='' data-hidden={hidden}>
          <span className={styles.passive} inert>
            <Checkbox label='Checked' labelHidden checked={kind.checked} />
          </span>
        </span>
      )

    case 'select':
      // Pills stay visible while editing: the inline editor's menu opens below the cell.
      return (
        <span className={styles.pills}>
          {kind.options.length > 0 ? (
            kind.options.map((option) => <StatusTag key={option.id} label={option.name} />)
          ) : (
            <span className={styles.placeholderText}>None</span>
          )}
        </span>
      )

    case 'json':
    case 'text':
      return (
        <span className={styles.cellText} data-hidden={hidden}>
          {kind.text}
        </span>
      )

    case 'date':
      return (
        <span className={styles.cellText} data-hidden={hidden}>
          {kind.raw ? kind.text : storageToDisplay(kind.text, { seconds: true })}
        </span>
      )

    case 'url':
      return (
        <span className={styles.linkCell} data-hidden={hidden}>
          <CellFavicon host={kind.domain} />
          <a
            href={kind.href}
            target='_blank'
            rel='noopener noreferrer'
            className={styles.link}
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
          isEditing={isEditing}
        />
      )

    case 'not-found':
      return <StatusCell hidden={isEditing} label='Not found' tip='No match found for this row.' />

    case 'no-output':
      return (
        <StatusCell
          hidden={isEditing}
          label='No output'
          tip='Finished with no value for this cell.'
        />
      )

    case 'empty':
      return null

    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

interface StatusCellProps {
  label: string
  intent?: 'warning' | 'danger'
  /** The hover explanation; a failed run shows its error message. */
  tip?: string
  hidden: boolean
}

/** A run state in its semantic ink, as Logs shows a run's status, with its explanation on hover. */
function StatusCell({ label, intent, tip, hidden }: StatusCellProps) {
  const tag = (
    <span className={styles.statusCell} data-hidden={hidden || undefined}>
      <StatusText label={label} intent={intent} />
    </span>
  )
  return tip ? <Tooltip label={tip}>{tag}</Tooltip> : tag
}

/**
 * Hosts whose icon failed recently, so a remounted cell renders the globe at once instead of an
 * empty slot. An entry lasts only as long as the favicon route retries an outage.
 */
const knownFaviconMisses = new LRUCache<string, true>({ max: 500, ttl: 5 * 60 * 1000 })

function CellFavicon({ host }: { host: string }) {
  const [, rerender] = useReducer((failures: number) => failures + 1, 0)
  if (knownFaviconMisses.has(host)) return <Icon name='I041' />
  return (
    <img
      src={faviconSrc(host)}
      alt=''
      loading='lazy'
      decoding='async'
      className={styles.favicon}
      onError={() => {
        knownFaviconMisses.set(host, true)
        rerender()
      }}
    />
  )
}

const FALLBACK_LABEL: Record<SimResourceType, string> = {
  workflow: 'Workflow',
  table: 'Table',
  knowledge: 'Knowledge base',
  file: 'File',
}

const RESOURCE_GLYPH = {
  workflow: 'I118',
  table: 'I033',
  knowledge: 'I004',
  file: 'I015',
} as const

interface SimResourceCellProps {
  /** Always the current workspace: only same-workspace URLs resolve to a chip. */
  workspaceId: string
  resourceType: SimResourceType
  resourceId: string
  isEditing: boolean
}

/**
 * A cell whose value is a URL to a resource in this workspace: the resource's glyph and its name,
 * linking to it here. Only the list matching the kind is fetched; a file is looked up by id.
 */
function SimResourceCell({
  workspaceId,
  resourceType,
  resourceId,
  isEditing,
}: SimResourceCellProps) {
  const hrefFor = usePlatformHref()
  const { data: workflows = [] } = useWorkflows(
    resourceType === 'workflow' ? workspaceId : undefined
  )
  const { data: tables = [] } = useTablesList(resourceType === 'table' ? workspaceId : undefined)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId, {
    enabled: resourceType === 'knowledge',
  })
  const { data: file } = useWorkspaceFileLookup(workspaceId, 'id', resourceId, {
    enabled: resourceType === 'file',
  })

  const name =
    resourceType === 'workflow'
      ? workflows.find((w) => w.id === resourceId)?.name
      : resourceType === 'table'
        ? tables.find((t) => t.id === resourceId)?.name
        : resourceType === 'knowledge'
          ? knowledgeBases.find((kb) => kb.id === resourceId)?.name
          : file?.name
  const label = name ?? FALLBACK_LABEL[resourceType]
  const href = hrefFor(
    `${workspacePath(workspaceId, RESOURCE_TAB[resourceType])}/${encodeURIComponent(resourceId)}`
  )

  return (
    <span className={styles.linkCell} data-hidden={isEditing || undefined}>
      <Icon name={RESOURCE_GLYPH[resourceType]} />
      <Link
        href={href}
        className={styles.link}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {label}
      </Link>
    </span>
  )
}

const TYPEWRITER_MS_PER_CHAR = 15

/**
 * Reveals `text` character by character when it changes after the first render; the first render
 * (mount or scroll-in) shows it statically. The slice derives from elapsed time during render, so
 * it is never `null` and never the whole string on the frame `text` changes.
 */
function useTypewriter(text: string | null): string | null {
  const [prevText, setPrevText] = useState<string | null>(text)
  const [, forceFrame] = useState(0)
  const mountedRef = useRef(false)
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
