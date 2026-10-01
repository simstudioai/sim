'use client'

import { type ComponentType, type ReactNode, useMemo, useState } from 'react'
import { ChipLink, cn } from '@sim/emcn'
import { ArrowUpRight, Database, File } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DiffView, type DiffViewMode } from '@/components/diff/diff-view'
import {
  type DiffLine,
  type DiffMatch,
  type DiffSource,
  matchUnifiedDiff,
  parseUnifiedDiff,
  sameSource,
  type UnifiedDiff,
} from '@/lib/diff/unified'
import { workspaceResourcePath } from '@/lib/resources'
import { useDocumentQuery, useKnowledgeDocumentText } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceFileContent, useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

type DiffState = DiffMatch | 'unavailable' | null

interface DiffEmbedProps {
  /** The fence body: a unified diff, optionally naming its `sim:` sources in `---`/`+++`. */
  source: string
  /** True while an agent is still writing the document, so the fence may be incomplete. */
  isStreaming: boolean
}
interface NoticeProps {
  children: ReactNode
  tone?: 'muted' | 'error'
}
/** A diff source resolved to what the card header shows and the text its hunks are matched to. */
interface ResolvedSource {
  title: string
  kindLabel: string
  icon: ComponentType<{ className?: string }>
  updated: string | null
  href: string
  segments: readonly string[] | undefined
  unavailable: boolean
}
interface CardHeading {
  title: string
  meta: string
  icon?: ComponentType<{ className?: string }>
  href?: string
}
interface ExcerptCardProps {
  heading: CardHeading
  diff: UnifiedDiff
  side: 'edit' | 'old' | 'new'
}
interface InlineMarkdownProps {
  text: string
}
interface ProseLineProps {
  line: DiffLine
  side: ExcerptCardProps['side']
}
interface CodeDiffProps {
  diff: UnifiedDiff
  heading: CardHeading
}

const NOTICE_CLASS =
  'rounded-lg bg-[var(--surface-5)] p-4 pr-16 text-caption dark:bg-[var(--surface-4)]'
const MARK = 'rounded-[3px] px-1 text-[var(--text-primary)]'

const STATE_LABELS: Record<Exclude<DiffMatch, 'current'> | 'unavailable', string> = {
  proposed: 'Proposed · not applied',
  outdated: 'Outdated · source changed',
  unavailable: 'Source unavailable',
}

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

function changeCounts(diff: UnifiedDiff): string {
  let added = 0
  let removed = 0
  for (const hunk of diff.hunks)
    for (const line of hunk.lines) {
      if (line.type === 'add') added++
      else if (line.type === 'del') removed++
    }
  return `+${added} −${removed}`
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
 * Resolves a `sim:` source for a header and its current text. Every query is disabled unless the
 * source is of its kind, so one hook serves both kinds and either side of a comparison.
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
  const fileContent = useWorkspaceFileContent(workspaceId ?? '', fileId, fileRecord.data?.key ?? '')
  const documentRecord = useDocumentQuery(knowledgeBaseId, documentId)
  const documentText = useKnowledgeDocumentText(knowledgeBaseId, documentId)
  if (!workspaceId || !source) return null
  if (source.kind === 'file')
    return {
      title: fileRecord.data?.name ?? 'File',
      kindLabel: 'Workspace file',
      icon: File,
      updated: formatDate(fileRecord.data?.updatedAt),
      href: workspaceResourcePath(workspaceId, 'file', source.fileId),
      segments: fileContent.data === undefined ? undefined : [fileContent.data],
      unavailable: (fileRecord.isSuccess && !fileRecord.data) || Boolean(fileContent.error),
    }
  return {
    title: documentRecord.data?.filename ?? 'Document',
    kindLabel: 'Knowledge base',
    icon: Database,
    updated: formatDate(documentRecord.data?.uploadedAt),
    href: `${workspaceResourcePath(workspaceId, 'knowledge', source.knowledgeBaseId)}/${encodeURIComponent(source.documentId)}`,
    segments: documentText.data,
    unavailable: documentRecord.isError || documentText.isError,
  }
}

function heading(resolved: ResolvedSource | null, fallback: string, detail: string): CardHeading {
  if (!resolved) return { title: fallback, meta: detail }
  return {
    title: resolved.title,
    meta: [resolved.kindLabel, resolved.updated && `Updated ${resolved.updated}`, detail]
      .filter(Boolean)
      .join(' · '),
    icon: resolved.icon,
    href: resolved.href,
  }
}

const INLINE_MARKDOWN = /(\*\*[^*]+\*\*|`[^`]+`)/

/** Renders the inline `**bold**` and `` `code` `` that source excerpts carry, as written. */
function InlineMarkdown({ text }: InlineMarkdownProps) {
  return (
    <>
      {text.split(INLINE_MARKDOWN).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={index} className='font-medium'>
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code
            key={index}
            className='rounded-[3px] bg-[var(--surface-5)] px-1 font-mono text-caption dark:bg-[var(--surface-4)]'
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        )
      )}
    </>
  )
}

/** Markdown headings read as headings; everything else is a paragraph of the source. */
function ProseLine({ line, side }: ProseLineProps) {
  const headingMatch = /^#{1,6}\s+(.*)$/.exec(line.text)
  const text = headingMatch ? headingMatch[1] : line.text
  const weight = headingMatch && 'font-medium'
  if (line.type === 'context')
    return (
      <p className={cn('text-[var(--text-muted)]', weight)}>
        <InlineMarkdown text={text} />
      </p>
    )
  const highlight =
    side !== 'edit'
      ? 'bg-[var(--badge-amber-bg)]'
      : line.type === 'add'
        ? 'bg-[var(--badge-success-bg)]'
        : 'bg-[var(--badge-error-bg)] line-through decoration-[var(--badge-error-text)]'
  return (
    <p>
      <mark className={cn(MARK, highlight, weight)}>
        <InlineMarkdown text={text} />
      </mark>
    </p>
  )
}

/**
 * A source excerpt in the shape of the page it quotes: unchanged text muted, changed text marked.
 * `old`/`new` show one side of a two-document comparison; `edit` shows both sides of one edit.
 */
function ExcerptCard({ heading, diff, side }: ExcerptCardProps) {
  const Icon = heading.icon
  const skip = side === 'old' ? 'add' : side === 'new' ? 'del' : null
  return (
    <article className='flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border)] px-4 py-3'>
      <header className='flex items-start gap-2 pr-14'>
        {Icon && <Icon className='mt-0.5 size-[14px] shrink-0 text-[var(--text-icon)]' />}
        <div className='flex min-w-0 flex-1 flex-col'>
          <div className='flex min-w-0 items-center gap-1'>
            <span className='truncate text-[var(--text-body)] text-small'>{heading.title}</span>
            {heading.href && (
              <Link href={heading.href} aria-label={`Open ${heading.title}`} className='shrink-0'>
                <ArrowUpRight className='size-[12px] text-[var(--text-icon)]' />
              </Link>
            )}
          </div>
          <span className='text-[var(--text-muted)] text-caption'>{heading.meta}</span>
        </div>
      </header>
      <div className='flex flex-col gap-2 text-small leading-relaxed'>
        {diff.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className='flex flex-col gap-2'>
            {hunkIndex > 0 && <p className='text-[var(--text-muted)] text-caption'>⋯</p>}
            {hunk.lines
              .filter((line) => line.type !== skip && line.text.trim() !== '')
              .map((line, index) => (
                <ProseLine key={index} line={line} side={side} />
              ))}
          </div>
        ))}
      </div>
    </article>
  )
}

/** Line-numbered diffs are code: a monospace view with a unified/split toggle. */
function CodeDiff({ diff, heading }: CodeDiffProps) {
  const [mode, setMode] = useState<DiffViewMode>('unified')
  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)] font-season'>
      <div className='flex items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-2)] py-1.5 pr-[68px] pl-3 text-caption'>
        <span className='shrink-0 text-[var(--text-body)]'>{heading.title}</span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>{heading.meta}</span>
        {(['unified', 'split'] as const).map((option) => (
          <button
            key={option}
            type='button'
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={cn(
              'shrink-0 capitalize transition-colors hover:text-[var(--text-body)]',
              mode === option ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
            )}
          >
            {option}
          </button>
        ))}
        {heading.href && (
          <ChipLink href={heading.href} rightIcon={ArrowUpRight} className='shrink-0'>
            Open
          </ChipLink>
        )}
      </div>
      <DiffView hunks={diff.hunks} mode={mode} />
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
 * When its header names workspace files or knowledge documents, the hunks are matched against
 * their current text and marked proposed or outdated when they no longer hold. Line-numbered
 * diffs render as code; everything else renders as excerpts of the pages it quotes. A public
 * share has no workspace session, so it renders without checking.
 */
export function DiffEmbed({ source, isStreaming }: DiffEmbedProps) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  const parsed = useMemo(() => parse(source), [source])
  const diff = parsed.diff
  const comparison = Boolean(
    diff?.oldSource && diff.newSource && !sameSource(diff.oldSource, diff.newSource)
  )
  const oldSide = useDiffSource(workspaceId, diff?.oldSource ?? null)
  const newSide = useDiffSource(workspaceId, comparison ? (diff?.newSource ?? null) : null)
  if (isStreaming) return <Notice>The diff loads when Sim finishes writing.</Notice>
  if (!diff) return <Notice tone='error'>{parsed.error}</Notice>

  const state: DiffState =
    !oldSide || (comparison && !newSide)
      ? null
      : oldSide.unavailable || newSide?.unavailable
        ? 'unavailable'
        : !oldSide.segments || (comparison && !newSide?.segments)
          ? null
          : matchUnifiedDiff(diff, oldSide.segments, newSide?.segments)
  const detail = state && state !== 'current' ? STATE_LABELS[state] : changeCounts(diff)
  const numbered = diff.hunks.some((hunk) =>
    hunk.lines.some((line) => line.oldLine !== undefined || line.newLine !== undefined)
  )

  if (numbered)
    return <CodeDiff diff={diff} heading={heading(oldSide, diff.path ?? 'Diff', detail)} />
  if (comparison)
    return (
      <div className='grid grid-cols-1 gap-3 font-season sm:grid-cols-2'>
        <ExcerptCard diff={diff} side='old' heading={heading(oldSide, 'Before', detail)} />
        <ExcerptCard diff={diff} side='new' heading={heading(newSide, 'After', detail)} />
      </div>
    )
  return (
    <div className='font-season'>
      <ExcerptCard
        diff={diff}
        side='edit'
        heading={heading(oldSide, diff.path ?? 'Edit', detail)}
      />
    </div>
  )
}
