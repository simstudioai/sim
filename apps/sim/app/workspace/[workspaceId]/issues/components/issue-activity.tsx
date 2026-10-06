'use client'

import { useState } from 'react'
import { Avatar, Chip, ChipTextarea } from '@sim/emcn'
import type { IssueEvent } from '@/lib/api/contracts/issues'
import { useSession } from '@/lib/auth/auth-client'
import { ISSUE_PRIORITY_LABELS, type IssuePriority } from '@/lib/issues/types'
import { useAddIssueComment, useDeleteIssueComment } from '@/hooks/queries/issues'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One sentence per change; Sim's document edits read as section changes, not diffs. */
function describe(event: IssueEvent): { what: string; detail?: string } {
  const p = event.payload
  switch (event.kind) {
    case 'created':
      return { what: 'filed this' }
    case 'renamed':
      return { what: 'renamed this', detail: `${text(p.from)} → ${text(p.to)}` }
    case 'section_added':
      return { what: `added ${text(p.heading)}`, detail: text(p.preview) || undefined }
    case 'section_removed':
      return { what: `removed ${text(p.heading)}` }
    case 'priority_changed':
      return { what: `set priority to ${ISSUE_PRIORITY_LABELS[p.to as IssuePriority] ?? ''}` }
    case 'owner_changed':
      return { what: p.to ? 'changed the owner' : 'removed the owner' }
    case 'work_started':
      return { what: 'started work with Sim' }
    case 'review_requested':
      return { what: 'requested review', detail: text(p.summary) || undefined }
    case 'approved':
      return { what: 'approved and closed this' }
    case 'changes_requested':
      return { what: 'requested changes', detail: text(p.note) || undefined }
    case 'closed':
      return {
        what:
          p.reason === 'duplicate'
            ? `closed this as a duplicate of ${text(p.duplicateOf)}`
            : p.reason === 'dismissed'
              ? 'dismissed this'
              : 'closed this',
      }
    case 'reopened':
      return { what: 'reopened this' }
    case 'resource_added':
      return { what: `added a ${text(p.type).replace('_', ' ')}` }
    case 'resource_removed':
      return { what: `removed a ${text(p.type).replace('_', ' ')}` }
    case 'ticket_linked':
      return { what: `linked ${text(p.key)}` }
    case 'ticket_unlinked':
      return { what: `unlinked ${text(p.key)}` }
    case 'chat_detached':
      return { what: 'lost its working chat' }
    default:
      return { what: event.kind.replaceAll('_', ' ') }
  }
}

function actorName(event: IssueEvent, names: Map<string, string>): string {
  if (!event.actor) return 'The issue'
  if (event.actor.kind === 'sim') return 'Sim'
  if (event.actor.kind === 'workflow') return 'A workflow'
  return (event.actor.userId && names.get(event.actor.userId)?.split(' ')[0]) || 'Someone'
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

interface IssueActivityProps {
  workspaceId: string
  issueKey: string
  events: IssueEvent[]
  members: Map<string, { name: string; image: string | null }>
  canEdit: boolean
}

/** The issue's changes and comments in order, with a box to add a comment. */
export function IssueActivity({
  workspaceId,
  issueKey,
  events,
  members,
  canEdit,
}: IssueActivityProps) {
  const names = new Map([...members].map(([id, member]) => [id, member.name]))
  return (
    <div className='flex flex-col gap-3'>
      <ol className='flex flex-col'>
        {events.map((event) =>
          event.kind === 'commented' ? (
            <IssueComment
              key={event.id}
              workspaceId={workspaceId}
              issueKey={issueKey}
              event={event}
              author={event.actor?.userId ? members.get(event.actor.userId) : undefined}
            />
          ) : (
            <IssueChange key={event.id} event={event} names={names} />
          )
        )}
      </ol>
      {canEdit && <CommentComposer workspaceId={workspaceId} issueKey={issueKey} />}
    </div>
  )
}

interface IssueChangeProps {
  event: IssueEvent
  names: Map<string, string>
}

function IssueChange({ event, names }: IssueChangeProps) {
  const { what, detail } = describe(event)
  return (
    <li className='flex flex-col py-1 text-caption'>
      <span className='flex gap-2'>
        <span className='min-w-0 flex-1 text-[var(--text-body)]'>
          <span className='text-[var(--text-primary)]'>{actorName(event, names)}</span> {what}
        </span>
        <time className='shrink-0 text-[var(--text-muted)]' dateTime={event.createdAt}>
          {timeFormat.format(new Date(event.createdAt))}
        </time>
      </span>
      {detail && <span className='text-[var(--text-muted)]'>{detail}</span>}
    </li>
  )
}

interface IssueCommentProps {
  workspaceId: string
  issueKey: string
  event: IssueEvent
  author: { name: string; image: string | null } | undefined
}

function IssueComment({ workspaceId, issueKey, event, author }: IssueCommentProps) {
  const { data: session } = useSession()
  const deleteComment = useDeleteIssueComment()
  const isOwn = Boolean(event.actor?.userId && event.actor.userId === session?.user?.id)
  const name = author?.name ?? 'Someone'
  return (
    <li className='my-2 flex flex-col gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2.5'>
      <span className='flex items-center gap-2 text-caption'>
        <Avatar size='xs' name={name} src={author?.image} aria-hidden />
        <span className='text-[var(--text-primary)]'>{name}</span>
        <time className='text-[var(--text-muted)]' dateTime={event.createdAt}>
          {timeFormat.format(new Date(event.createdAt))}
        </time>
        {isOwn && (
          <Chip
            className='ml-auto'
            disabled={deleteComment.isPending}
            onClick={() =>
              deleteComment.mutate({ workspaceId, key: issueKey, commentId: event.id })
            }
          >
            Delete
          </Chip>
        )}
      </span>
      <p className='whitespace-pre-wrap text-[var(--text-body)] text-small'>
        {text(event.payload.body)}
      </p>
    </li>
  )
}

interface CommentComposerProps {
  workspaceId: string
  issueKey: string
}

function CommentComposer({ workspaceId, issueKey }: CommentComposerProps) {
  const [body, setBody] = useState('')
  const addComment = useAddIssueComment()
  const submit = () => {
    if (!body.trim() || addComment.isPending) return
    const submitted = body
    addComment.mutate(
      { workspaceId, key: issueKey, body: submitted },
      { onSuccess: () => setBody((current) => (current === submitted ? '' : current)) }
    )
  }
  return (
    <div className='flex flex-col gap-2'>
      <ChipTextarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder='Leave a comment'
        rows={3}
        aria-label='Comment'
      />
      {addComment.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {addComment.error.message}
        </p>
      )}
      <Chip
        variant='primary'
        className='self-end'
        disabled={!body.trim() || addComment.isPending}
        onClick={submit}
      >
        Comment
      </Chip>
    </div>
  )
}
