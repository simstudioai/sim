'use client'

import type React from 'react'
import { parse } from 'tldts'
import { Badge, Checkbox, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { RowExecutionMetadata } from '@/lib/table'
import { StatusBadge } from '@/app/workspace/[workspaceId]/logs/utils'
import { storageToDisplay } from '../../../utils'
import type { DisplayColumn } from '../types'

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
  // Plain typed cells
  | { kind: 'boolean'; checked: boolean }
  | { kind: 'json'; text: string }
  | { kind: 'date'; text: string }
  | { kind: 'url'; text: string; href: string; domain: string }
  | { kind: 'text'; text: string }
  // Universal fallback
  | { kind: 'empty' }

interface ResolveCellRenderInput {
  value: unknown
  exec: RowExecutionMetadata | undefined
  column: DisplayColumn
  waitingOnLabels: string[] | undefined
}

export function resolveCellRender({
  value,
  exec,
  column,
  waitingOnLabels,
}: ResolveCellRenderInput): CellRenderKind {
  const isNull = value === null || value === undefined

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
    // while other blocks in the group are still running.
    if (!isNull) return { kind: 'value', text: stringifyValue(value) }

    if (inFlight && !(groupHasBlockErrors && !blockRunning)) {
      if (exec?.status === 'queued' || exec?.status === 'pending') return { kind: 'queued' }
      return { kind: 'pending-upstream' }
    }

    // Waiting wins over a stale terminal status — show the actionable state.
    if (waitingOnLabels && waitingOnLabels.length > 0) {
      return { kind: 'waiting', labels: waitingOnLabels }
    }
    if (exec?.status === 'cancelled') return { kind: 'cancelled' }
    if (exec?.status === 'error') return { kind: 'error' }
    return { kind: 'empty' }
  }

  if (column.type === 'boolean') return { kind: 'boolean', checked: Boolean(value) }
  if (isNull) return { kind: 'empty' }
  if (column.type === 'json') return { kind: 'json', text: JSON.stringify(value) }
  if (column.type === 'date') return { kind: 'date', text: String(value) }
  if (column.type === 'string') {
    const text = stringifyValue(value)
    const urlInfo = extractUrlInfo(text)
    if (urlInfo) return { kind: 'url', text, href: urlInfo.href, domain: urlInfo.domain }
    return { kind: 'text', text }
  }
  return { kind: 'text', text: stringifyValue(value) }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
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

interface CellRenderProps {
  kind: CellRenderKind
  isEditing: boolean
}

export function CellRender({ kind, isEditing }: CellRenderProps): React.ReactElement | null {
  switch (kind.kind) {
    case 'value':
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
              'min-w-0 overflow-clip text-ellipsis text-[var(--text-primary)] underline underline-offset-2 hover:opacity-70',
              isEditing && 'pointer-events-none'
            )}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {kind.text}
          </a>
        </span>
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
