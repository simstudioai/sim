'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { ChipLink, cn } from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { DiffView, type DiffViewMode } from '@/components/diff/diff-view'
import {
  type DiffMatch,
  matchUnifiedDiff,
  parseUnifiedDiff,
  type UnifiedDiff,
} from '@/lib/diff/unified'
import { workspaceResourcePath } from '@/lib/resources'
import { useDocumentQuery, useKnowledgeDocumentText } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceFileContent, useWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

type DiffState = DiffMatch | 'unavailable' | null

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
interface DiffFrameProps {
  diff: UnifiedDiff
  title: string
  href?: string
  state?: DiffState
}
interface SourceDiffProps {
  diff: UnifiedDiff
  workspaceId: string
}
interface FileSourceDiffProps extends SourceDiffProps {
  fileId: string
}
interface KnowledgeSourceDiffProps extends SourceDiffProps {
  knowledgeBaseId: string
  documentId: string
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

/**
 * The bordered frame every diff renders in: title and status in a header bar, the view below. The
 * header reserves its right edge for the code block's hover controls.
 */
function DiffFrame({ diff, title, href, state }: DiffFrameProps) {
  const [mode, setMode] = useState<DiffViewMode>('unified')
  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)] font-season'>
      <div className='flex items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-2)] py-1.5 pr-[68px] pl-3 text-caption'>
        <span className='shrink-0 text-[var(--text-body)]'>{title}</span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>
          {state && state !== 'current' ? STATE_LABELS[state] : changeCounts(diff)}
        </span>
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
        {href && (
          <ChipLink href={href} rightIcon={ArrowUpRight} className='shrink-0'>
            Open
          </ChipLink>
        )}
      </div>
      <DiffView hunks={diff.hunks} mode={mode} />
    </div>
  )
}

function FileSourceDiff({ diff, workspaceId, fileId }: FileSourceDiffProps) {
  const record = useWorkspaceFileRecord(workspaceId, fileId)
  const content = useWorkspaceFileContent(workspaceId, fileId, record.data?.key ?? '')
  const state =
    (record.isSuccess && !record.data) || content.error
      ? 'unavailable'
      : content.data === undefined
        ? null
        : matchUnifiedDiff(diff, [content.data])
  return (
    <DiffFrame
      diff={diff}
      title={record.data?.name ?? 'File'}
      href={workspaceResourcePath(workspaceId, 'file', fileId)}
      state={state}
    />
  )
}

function KnowledgeSourceDiff({
  diff,
  workspaceId,
  knowledgeBaseId,
  documentId,
}: KnowledgeSourceDiffProps) {
  const record = useDocumentQuery(knowledgeBaseId, documentId)
  const text = useKnowledgeDocumentText(knowledgeBaseId, documentId)
  const state =
    record.isError || text.isError
      ? 'unavailable'
      : text.data === undefined
        ? null
        : matchUnifiedDiff(diff, text.data)
  return (
    <DiffFrame
      diff={diff}
      title={record.data?.filename ?? 'Document'}
      href={`${workspaceResourcePath(workspaceId, 'knowledge', knowledgeBaseId)}/${encodeURIComponent(documentId)}`}
      state={state}
    />
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
  if (diff.source && workspaceId)
    return diff.source.kind === 'file' ? (
      <FileSourceDiff diff={diff} workspaceId={workspaceId} fileId={diff.source.fileId} />
    ) : (
      <KnowledgeSourceDiff
        diff={diff}
        workspaceId={workspaceId}
        knowledgeBaseId={diff.source.knowledgeBaseId}
        documentId={diff.source.documentId}
      />
    )
  return <DiffFrame diff={diff} title={diff.path ?? 'Diff'} />
}
