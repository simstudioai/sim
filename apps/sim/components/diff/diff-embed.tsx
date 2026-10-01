'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DiffView, type DiffViewMode } from '@/components/diff/diff-view'
import {
  type DiffMatch,
  type DiffSource,
  matchUnifiedDiff,
  parseUnifiedDiff,
  type UnifiedDiff,
} from '@/lib/diff/unified'
import { workspaceResourcePath } from '@/lib/resources'
import { useDocumentQuery, useKnowledgeDocumentText } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceFileContent, useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

interface DiffEmbedProps {
  /** The fence body: a unified diff, optionally naming its `sim:` source in `---`/`+++`. */
  source: string
  /** True while an agent is still writing the document, so the fence may be incomplete. */
  isStreaming: boolean
}
interface NoticeProps {
  children: ReactNode
  tone?: 'muted' | 'error'
}
interface SourceHeaderProps {
  diff: UnifiedDiff
  workspaceId: string
}
interface FileSourceHeaderProps extends SourceHeaderProps {
  fileId: string
}
interface KnowledgeSourceHeaderProps extends SourceHeaderProps {
  knowledgeBaseId: string
  documentId: string
}
interface SourceLabelProps {
  label: string | undefined
  href: string
  state: DiffMatch | 'unavailable' | null
}
interface DiffBodyProps {
  diff: UnifiedDiff
  header: ReactNode
}

const NOTICE_CLASS =
  'rounded-lg bg-[var(--surface-5)] p-4 pr-16 text-caption dark:bg-[var(--surface-4)]'

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

function SourceLabel({ label, href, state }: SourceLabelProps) {
  return (
    <p className='flex flex-wrap items-center gap-x-2 text-caption'>
      <Link href={href} className='text-[var(--text-body)] hover:underline'>
        {label ?? 'Source'}
      </Link>
      {state && state !== 'current' && (
        <span className='text-[var(--text-muted)]'>{STATE_LABELS[state]}</span>
      )}
    </p>
  )
}

function FileSourceHeader({ diff, workspaceId, fileId }: FileSourceHeaderProps) {
  const record = useWorkspaceFileRecord(workspaceId, fileId)
  const content = useWorkspaceFileContent(workspaceId, fileId, record.data?.key ?? '')
  const state =
    record.isSuccess && !record.data
      ? 'unavailable'
      : content.error
        ? 'unavailable'
        : content.data === undefined
          ? null
          : matchUnifiedDiff(diff, [content.data])
  return (
    <SourceLabel
      label={record.data?.name}
      href={workspaceResourcePath(workspaceId, 'file', fileId)}
      state={state}
    />
  )
}

function KnowledgeSourceHeader({
  diff,
  workspaceId,
  knowledgeBaseId,
  documentId,
}: KnowledgeSourceHeaderProps) {
  const record = useDocumentQuery(knowledgeBaseId, documentId)
  const text = useKnowledgeDocumentText(knowledgeBaseId, documentId)
  const state =
    record.isError || text.isError
      ? 'unavailable'
      : text.data === undefined
        ? null
        : matchUnifiedDiff(diff, text.data)
  return (
    <SourceLabel
      label={record.data?.filename}
      href={`${workspaceResourcePath(workspaceId, 'knowledge', knowledgeBaseId)}/${encodeURIComponent(documentId)}`}
      state={state}
    />
  )
}

function sourceHeader(source: DiffSource, diff: UnifiedDiff, workspaceId: string) {
  return source.kind === 'file' ? (
    <FileSourceHeader diff={diff} workspaceId={workspaceId} fileId={source.fileId} />
  ) : (
    <KnowledgeSourceHeader
      diff={diff}
      workspaceId={workspaceId}
      knowledgeBaseId={source.knowledgeBaseId}
      documentId={source.documentId}
    />
  )
}

function DiffBody({ diff, header }: DiffBodyProps) {
  const [mode, setMode] = useState<DiffViewMode>('unified')
  return (
    <div className='flex flex-col gap-2 pt-8 font-season'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>{header}</div>
        <div className='flex shrink-0 items-center gap-2 text-caption'>
          {(['unified', 'split'] as const).map((option) => (
            <button
              key={option}
              type='button'
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                'capitalize transition-colors hover:text-[var(--text-body)]',
                mode === option ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <DiffView hunks={diff.hunks} mode={mode} />
    </div>
  )
}

/**
 * A ```diff fence: the change is written into the document, so it renders without any history.
 * When its header names a workspace file or knowledge document, the hunks are matched against
 * that source's current text and the diff is marked proposed or outdated when it no longer holds.
 * A public share has no workspace session, so it renders the diff without checking.
 */
export function DiffEmbed({ source, isStreaming }: DiffEmbedProps) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  const parsed = useMemo(() => {
    try {
      return { diff: parseUnifiedDiff(source) }
    } catch (error) {
      return { error: getErrorMessage(error, 'Invalid diff') }
    }
  }, [source])
  if (isStreaming) return <Notice>The diff loads when Sim finishes writing.</Notice>
  if (!parsed.diff) return <Notice tone='error'>{parsed.error}</Notice>
  const { diff } = parsed
  return (
    <DiffBody
      diff={diff}
      header={diff.source && workspaceId ? sourceHeader(diff.source, diff, workspaceId) : null}
    />
  )
}
