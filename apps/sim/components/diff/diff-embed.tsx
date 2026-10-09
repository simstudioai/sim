'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import { ArrowUpRight, Database, File } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DiffView } from '@/components/diff/diff-view'
import { type DiffSource, parseUnifiedDiff, sameSource, type UnifiedDiff } from '@/lib/diff/unified'
import { workspaceResourcePath } from '@/lib/resources'
import { useDocumentQuery } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

interface DiffEmbedProps {
  /** The fence body: a unified diff, optionally naming its `sim:` sources in `---`/`+++`. */
  source: string
  /** True while an agent is still writing the document, so the fence may be incomplete. */
  isStreaming: boolean
  wrapLines?: boolean
}
interface NoticeProps {
  children: ReactNode
  tone?: 'muted' | 'error'
}
/** A diff source resolved to what its card header shows. */
interface ResolvedSource {
  title: string
  kindLabel: string
  icon: ComponentType<{ className?: string }>
  updated: string | null
  href: string
}
interface CardHeading {
  title: string
  meta: string
  icon?: ComponentType<{ className?: string }>
  href?: string
}
interface SourceHeadingProps {
  heading: CardHeading
  side?: 'Before' | 'After'
}
interface CodeDiffProps {
  diff: UnifiedDiff
  heading: CardHeading
  wrapLines: boolean
}
interface DocumentComparisonProps {
  diff: UnifiedDiff
  oldHeading: CardHeading
  newHeading: CardHeading
  wrapLines: boolean
}
interface ChangeCountsProps {
  diff: UnifiedDiff
}

const NOTICE_CLASS =
  'min-h-[56px] rounded-lg bg-[var(--surface-5)] p-4 pr-[140px] text-caption sm:pr-[120px] dark:bg-[var(--surface-4)]'

function Notice({ children, tone = 'muted' }: NoticeProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        NOTICE_CLASS,
        'whitespace-pre-wrap',
        tone === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
      )}
    >
      {children}
    </div>
  )
}

function ChangeCounts({ diff }: ChangeCountsProps) {
  let added = 0
  let removed = 0
  for (const hunk of diff.hunks)
    for (const line of hunk.lines) {
      if (line.type === 'add') added++
      else if (line.type === 'del') removed++
    }
  return (
    <div className='flex shrink-0 items-center gap-3 font-mono text-caption tabular-nums'>
      <span
        aria-label={`${added} added ${added === 1 ? 'line' : 'lines'}`}
        className='text-[var(--badge-success-text)]'
      >
        +{added}
      </span>
      <span
        aria-label={`${removed} removed ${removed === 1 ? 'line' : 'lines'}`}
        className='text-[var(--badge-error-text)]'
      >
        −{removed}
      </span>
    </div>
  )
}

function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

/**
 * Resolves a `sim:` source for its card header. Every query is disabled unless the source is of
 * its kind, so one hook serves both kinds and either side of a comparison.
 */
function useDiffSource(
  workspaceId: string | null,
  source: DiffSource | null
): ResolvedSource | null {
  const fileId = workspaceId && source?.kind === 'file' ? source.fileId : ''
  const knowledgeBaseId =
    workspaceId && source?.kind === 'knowledge' ? source.knowledgeBaseId : undefined
  const documentId = workspaceId && source?.kind === 'knowledge' ? source.documentId : undefined
  const fileRecord = useWorkspaceFileRecord(workspaceId ?? '', fileId)
  const documentRecord = useDocumentQuery(knowledgeBaseId, documentId)
  if (!workspaceId || !source) return null
  if (source.kind === 'file')
    return {
      title: fileRecord.data?.name ?? 'File',
      kindLabel: 'Workspace file',
      icon: File,
      updated: formatDate(fileRecord.data?.updatedAt),
      href: workspaceResourcePath(workspaceId, 'file', source.fileId),
    }
  return {
    title: documentRecord.data?.filename ?? 'Document',
    kindLabel: 'Knowledge base',
    icon: Database,
    updated: formatDate(documentRecord.data?.uploadedAt),
    href: `${workspaceResourcePath(workspaceId, 'knowledge', source.knowledgeBaseId)}/${encodeURIComponent(source.documentId)}`,
  }
}

function heading(resolved: ResolvedSource | null, fallback: string): CardHeading {
  if (!resolved) return { title: fallback, meta: '' }
  return {
    title: resolved.title,
    meta: [resolved.kindLabel, resolved.updated && `Updated ${resolved.updated}`]
      .filter(Boolean)
      .join(' · '),
    icon: resolved.icon,
    href: resolved.href,
  }
}

function SourceHeading({ heading, side }: SourceHeadingProps) {
  const Icon = heading.icon ?? File
  return (
    <div className='flex min-w-0 flex-1 items-center gap-2'>
      <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        {side && heading.title !== side && (
          <span className='text-[var(--text-muted)] text-caption'>{side}</span>
        )}
        <div className='flex min-w-0 items-center gap-1'>
          <OverflowText label={heading.title} className='text-[var(--text-primary)] text-small' />
          {heading.href && (
            <Link href={heading.href} aria-label={`Open ${heading.title}`} className='shrink-0'>
              <ArrowUpRight className='size-[14px] text-[var(--text-icon)]' />
            </Link>
          )}
        </div>
        {heading.meta && (
          <OverflowText label={heading.meta} className='text-[var(--text-muted)] text-caption' />
        )}
      </div>
    </div>
  )
}

function DocumentComparison({ diff, oldHeading, newHeading, wrapLines }: DocumentComparisonProps) {
  return (
    <div className='@container/diff overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] font-season'>
      <div className='grid grid-cols-2 border-[var(--border)] border-b @min-[480px]/diff:pt-0 pt-[56px]'>
        <header className='flex min-w-0 items-center px-4 py-3'>
          <SourceHeading heading={oldHeading} side='Before' />
        </header>
        <header className='flex min-w-0 items-center border-[var(--border)] border-l px-4 py-3 @min-[480px]/diff:pr-[140px] sm:@min-[480px]/diff:pr-[120px]'>
          <SourceHeading heading={newHeading} side='After' />
        </header>
      </div>
      <DiffView hunks={diff.hunks} prose wrapLines={wrapLines} />
    </div>
  )
}

function CodeDiff({ diff, heading, wrapLines }: CodeDiffProps) {
  return (
    <div className='@container/diff overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] font-season'>
      <header className='flex min-h-[56px] items-center gap-4 border-[var(--border)] border-b px-4 @min-[480px]/diff:pt-3 pt-[56px] @min-[480px]/diff:pr-[140px] pb-3 sm:@min-[480px]/diff:pr-[120px]'>
        <SourceHeading heading={heading} />
        <ChangeCounts diff={diff} />
      </header>
      <DiffView hunks={diff.hunks} wrapLines={wrapLines} />
    </div>
  )
}

function parse(
  source: string
): { diff: UnifiedDiff; error?: never } | { error: string; diff?: never } {
  try {
    return { diff: parseUnifiedDiff(source) }
  } catch (error) {
    return { error: getErrorMessage(error, 'Invalid diff') }
  }
}

/**
 * A ```diff fence: the change is written into the document, so it renders without any history.
 * `sim:` sources in its header name the workspace files or knowledge documents it quotes, shown
 * with a link in each card header. An edit renders line by line; two different documents render
 * as side-by-side excerpts. A public share has no workspace session, so it shows no source names.
 */
export function DiffEmbed({ source, isStreaming, wrapLines = true }: DiffEmbedProps) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  const parsed = parse(source)
  const diff = parsed.diff
  const comparison = Boolean(
    diff?.oldSource && diff.newSource && !sameSource(diff.oldSource, diff.newSource)
  )
  const oldSide = useDiffSource(workspaceId, diff?.oldSource ?? null)
  const newSide = useDiffSource(workspaceId, comparison ? (diff?.newSource ?? null) : null)
  if (isStreaming) return <Notice>The diff loads when Sim finishes writing.</Notice>
  if (!diff) return <Notice tone='error'>{parsed.error}</Notice>

  if (comparison)
    return (
      <DocumentComparison
        key={source}
        diff={diff}
        oldHeading={heading(oldSide, 'Before')}
        newHeading={heading(newSide, 'After')}
        wrapLines={wrapLines}
      />
    )
  return (
    <CodeDiff
      key={source}
      diff={diff}
      heading={heading(oldSide, diff.path ?? 'Diff')}
      wrapLines={wrapLines}
    />
  )
}
