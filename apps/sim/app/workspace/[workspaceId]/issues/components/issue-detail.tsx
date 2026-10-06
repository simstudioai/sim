'use client'

import { useCallback, useState } from 'react'
import { Chip, ChipLink, cn, OverflowText, pageHeadingClassName, toast } from '@sim/emcn'
import { ArrowUpRight, ListChecks } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { requestJson } from '@/lib/api/client/request'
import type { IssueDetail as IssueDetailData, IssueRecord } from '@/lib/api/contracts/issues'
import {
  addMothershipChatResourceContract,
  createMothershipChatContract,
} from '@/lib/api/contracts/mothership-chats'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/mothership/constants'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { FileDocRoomProvider } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-room-context'
import { IssueActivity } from '@/app/workspace/[workspaceId]/issues/components/issue-activity'
import { IssueProperties } from '@/app/workspace/[workspaceId]/issues/components/issue-properties'
import { IssueStatusIcon } from '@/app/workspace/[workspaceId]/issues/components/issue-status'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useApproveIssue,
  useCloseIssue,
  useIssue,
  useReopenIssue,
  useRequestIssueChanges,
  useStartIssue,
} from '@/hooks/queries/issues'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useAddressedWorkspaceFileRecord } from '@/hooks/queries/workspace-files'

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** Matches the document editor's reading column so the bar, title, and footer line up with the text. */
const COLUMN_CLASS = 'mx-auto w-full max-w-[48rem] px-8'

interface IssueDetailProps {
  workspaceId: string
  issueKey: string
}

export function IssueDetail({ workspaceId, issueKey }: IssueDetailProps) {
  const router = useRouter()
  const query = useIssue(workspaceId, issueKey)
  const issue = query.data?.issue
  const canEdit = useUserPermissionsContext().canEdit === true
  const closeIssue = useCloseIssue()
  const reopenIssue = useReopenIssue()

  const actions = !issue
    ? []
    : issue.status === 'done'
      ? [
          {
            text: 'Reopen',
            disabled: !canEdit || reopenIssue.isPending,
            onSelect: () => reopenIssue.mutate({ workspaceId, key: issue.key }),
          },
        ]
      : [
          {
            text: 'Dismiss',
            disabled: !canEdit || closeIssue.isPending,
            onSelect: () => closeIssue.mutate({ workspaceId, key: issue.key, reason: 'dismissed' }),
          },
        ]

  return (
    <FileDocRoomProvider>
      <Resource>
        <Resource.Header
          breadcrumbs={[
            {
              label: 'Issues',
              icon: ListChecks,
              onClick: () => router.push(`/workspace/${workspaceId}/issues`),
            },
            { label: issue?.key ?? issueKey },
          ]}
          actions={actions}
        />
        <IssueView workspaceId={workspaceId} issueKey={issueKey} />
      </Resource>
    </FileDocRoomProvider>
  )
}

/**
 * The issue's document, shared by the issue page and its resource tab in Chat. Render it inside a
 * {@link FileDocRoomProvider} so collaborators show up in the document.
 *
 * Reads like a post: key and filer above the title, a row of properties under it, and one
 * highlighted line for the next step. Once the properties scroll away, a compact bar takes over.
 */
export function IssueView({ workspaceId, issueKey }: IssueDetailProps) {
  const query = useIssue(workspaceId, issueKey)
  const issue = query.data?.issue
  const file = useAddressedWorkspaceFileRecord(workspaceId, issue?.bodyFileId ?? '', {
    enabled: Boolean(issue),
  })
  const canEdit = useUserPermissionsContext().canEdit === true
  const [bylineOutOfView, setBylineOutOfView] = useState(false)

  const bylineRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const observer = new IntersectionObserver(([entry]) =>
      setBylineOutOfView(!entry.isIntersecting)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (query.error) {
    return (
      <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
        {query.error.message}
      </p>
    )
  }
  if (!issue || !query.data) return null

  return (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <IssueBar
        workspaceId={workspaceId}
        issue={issue}
        canEdit={canEdit}
        visible={bylineOutOfView}
      />
      {file.data ? (
        <FileViewer
          key={file.data.id}
          file={file.data}
          workspaceId={workspaceId}
          canEdit={canEdit}
          collaborative
          enableFind
          header={
            <div className={cn(COLUMN_CLASS, 'flex flex-col gap-3 pt-12')}>
              <IssueEyebrow issue={issue} />
              <h1 className={pageHeadingClassName}>{issue.title}</h1>
              <div ref={bylineRef}>
                <IssueProperties workspaceId={workspaceId} detail={query.data} canEdit={canEdit} />
              </div>
              <div className='pt-2'>
                <IssueAssistant workspaceId={workspaceId} issue={issue} canEdit={canEdit} />
              </div>
            </div>
          }
          footer={<IssueFooter workspaceId={workspaceId} detail={query.data} canEdit={canEdit} />}
        />
      ) : file.error ? (
        <p role='alert' className='p-6 text-[var(--text-error)] text-small'>
          {file.error.message}
        </p>
      ) : null}
    </div>
  )
}

/** Key, who filed it, and when, above the title. */
interface IssueEyebrowProps {
  issue: IssueRecord
}

function IssueEyebrow({ issue }: IssueEyebrowProps) {
  return (
    <p className='text-[var(--text-muted)] text-caption'>
      {[issue.key, filedBy(issue), dateFormat.format(new Date(issue.createdAt))].join(' · ')}
    </p>
  )
}

interface IssueBarProps {
  workspaceId: string
  issue: IssueRecord
  canEdit: boolean
  visible: boolean
}

/** Once the properties scroll away, a compact bar keeps the title and the actions in reach. */
function IssueBar({ workspaceId, issue, canEdit, visible }: IssueBarProps) {
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'absolute inset-x-0 top-0 z-10 border-[var(--border)] border-b bg-[var(--bg)] transition-opacity duration-150',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <div className={cn(COLUMN_CLASS, 'flex h-[48px] items-center gap-3 text-small')}>
        <OverflowText label={issue.title} className='flex-1 text-[var(--text-primary)]' />
        <div className='flex shrink-0 items-center gap-2'>
          <IssueActions
            workspaceId={workspaceId}
            issue={issue}
            canEdit={canEdit}
            chatHref={
              issue.workingChat ? `/workspace/${workspaceId}/chat/${issue.workingChat.id}` : null
            }
          />
        </div>
      </div>
    </div>
  )
}

interface IssueFooterProps {
  workspaceId: string
  detail: IssueDetailData
  canEdit: boolean
}

/** The activity timeline and comments, read after the document. */
function IssueFooter({ workspaceId, detail, canEdit }: IssueFooterProps) {
  const { events } = detail
  const members = useWorkspaceMembersQuery(workspaceId)
  const people = new Map(
    (members.data ?? []).map((member) => [
      member.userId,
      { name: member.name, image: member.image },
    ])
  )

  return (
    <div className={cn(COLUMN_CLASS, 'flex flex-col gap-8 pb-16')}>
      <div className='border-[var(--border)] border-t' />
      <section aria-labelledby='issue-activity' className='flex flex-col gap-1'>
        <h2 id='issue-activity' className='text-[var(--text-muted)] text-small'>
          Activity
        </h2>
        <IssueActivity
          workspaceId={workspaceId}
          issueKey={detail.issue.key}
          events={events}
          members={people}
          canEdit={canEdit}
        />
      </section>
    </div>
  )
}

/** The prompt that opens an issue's chat; Sim reads and writes the issue document by key. */
function changesPrompt(issue: IssueRecord): string {
  return `I reviewed ${issue.key} and it needs more work. Pick it up again from issues/${issue.key}.md, and ask me to review when it is ready.`
}

function issuePrompt(issue: IssueRecord, followUp: boolean): string {
  const document = `issues/${issue.key}.md`
  return followUp
    ? `Follow up on ${issue.key}: ${issue.title}. It was closed and is open again; the issue document is ${document}. Pick up from what it says, write what you learn into it, and ask me to review when it is done.`
    : `Work on ${issue.key}: ${issue.title}. The issue document is ${document}. Read it, find the cause, write what you learn into it, and ask me to review when it is fixed.`
}

interface IssueAssistantProps {
  workspaceId: string
  issue: IssueRecord
  canEdit: boolean
}

function filedBy(issue: IssueRecord): string {
  if (issue.filedBy.kind === 'workflow') return 'Filed by a workflow'
  if (issue.filedBy.kind === 'sim') return 'Filed by Sim'
  return issue.filedBy.name ? `Filed by ${issue.filedBy.name}` : 'Filed'
}

function closedAs(issue: IssueRecord): string {
  if (issue.closeReason === 'dismissed') return 'Dismissed'
  if (issue.closeReason === 'duplicate') return 'Closed as a duplicate'
  return 'Approved and closed'
}

/**
 * One highlighted line under the byline. A new issue asks to be started; from then on the line is
 * Sim: what it is doing, its result to review, or how the issue closed, with the action for that.
 */
function IssueAssistant({ workspaceId, issue, canEdit }: IssueAssistantProps) {
  const chatHref = issue.workingChat
    ? `/workspace/${workspaceId}/chat/${issue.workingChat.id}`
    : null
  const isNew = issue.status === 'inbox' && issue.inboxKind === 'new'
  const isReview = issue.status === 'inbox' && issue.inboxKind === 'review'

  return (
    <div className='flex min-h-[48px] items-center gap-3 rounded-lg bg-[var(--surface-5)] px-3 py-2 text-small'>
      <span className='flex size-[14px] shrink-0 items-center justify-center'>
        <IssueStatusIcon issue={issue} />
      </span>
      <span className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
        {isNew ? (
          <>
            {filedBy(issue)}
            <span className='text-[var(--text-muted)]'> · Start it to have Sim work on it</span>
          </>
        ) : issue.status === 'in_progress' ? (
          issue.workingChat?.running ? (
            <ShimmerText>Sim is working</ShimmerText>
          ) : (
            <>
              Sim stopped
              <span className='text-[var(--text-muted)]'> · Continue in the chat</span>
            </>
          )
        ) : isReview ? (
          (issue.reviewSummary ?? 'Sim finished and is waiting for your review')
        ) : (
          closedAs(issue)
        )}
      </span>
      <IssueActions workspaceId={workspaceId} issue={issue} canEdit={canEdit} chatHref={chatHref} />
    </div>
  )
}

interface IssueActionsProps {
  workspaceId: string
  issue: IssueRecord
  canEdit: boolean
  chatHref: string | null
}

/** The actions for the issue's state; the one black chip is what moves it forward. */
function IssueActions({ workspaceId, issue, canEdit, chatHref }: IssueActionsProps) {
  const queryClient = useQueryClient()
  const startIssue = useStartIssue()
  const approveIssue = useApproveIssue()
  const requestChanges = useRequestIssueChanges()
  const reopenIssue = useReopenIssue()
  const [opening, setOpening] = useState(false)

  /**
   * Sends a message without leaving the page: the chat's run continues server-side once this page
   * stops listening to the stream.
   */
  async function sendToChat(chatId: string, message: string) {
    // boundary-raw-fetch: the chat send responds with an SSE stream; only its acceptance matters here, the run continues server-side once the reader is cancelled
    const response = await fetch(MOTHERSHIP_CHAT_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        workspaceId,
        chatId,
        userMessageId: generateId(),
        createNewChat: false,
      }),
    })
    if (!response.ok) throw new Error('Sim could not start on this issue')
    await response.body?.cancel()
    void queryClient.invalidateQueries({ queryKey: mothershipChatKeys.workspaceLists(workspaceId) })
  }

  /**
   * Starts a new chat on the issue, with the issue as its tab. A follow-up on a closed issue
   * reopens it first, so the new chat becomes its working chat and appears in its history.
   */
  async function startChat(followUp: boolean) {
    setOpening(true)
    let started = false
    try {
      if (followUp) await reopenIssue.mutateAsync({ workspaceId, key: issue.key })
      const chat = await requestJson(createMothershipChatContract, { body: { workspaceId } })
      await requestJson(addMothershipChatResourceContract, {
        body: { chatId: chat.id, resource: { type: 'issue', id: issue.key, title: issue.title } },
      })
      await startIssue.mutateAsync({ workspaceId, key: issue.key, chatId: chat.id })
      started = true
      await sendToChat(chat.id, issuePrompt(issue, followUp))
      toast.success(
        followUp ? `Started a follow-up on ${issue.key}` : `Sim is working on ${issue.key}`
      )
    } catch (error) {
      toast.error(
        started
          ? 'The chat is ready but its first message did not send. Open the chat to send it again.'
          : getErrorMessage(error, 'Sim could not start on this issue')
      )
    } finally {
      setOpening(false)
    }
  }

  /** Sends the issue back to its working chat, and tells that chat to keep going. */
  async function sendBackForChanges() {
    const chatId = issue.workingChat?.id
    if (!chatId) return
    setOpening(true)
    let reopened = false
    try {
      await requestChanges.mutateAsync({ workspaceId, key: issue.key })
      reopened = true
      await sendToChat(chatId, changesPrompt(issue))
      toast.success(`Sim is back on ${issue.key}`)
    } catch (error) {
      toast.error(
        reopened
          ? 'Changes were requested but the chat did not get the message. Open the chat to send it.'
          : getErrorMessage(error, 'Could not request changes')
      )
    } finally {
      setOpening(false)
    }
  }

  const openChatLink = chatHref ? (
    <ChipLink variant='outline' href={chatHref} rightIcon={ArrowUpRight}>
      Open chat
    </ChipLink>
  ) : null

  if (issue.status === 'inbox' && issue.inboxKind === 'new') {
    return (
      <Chip variant='primary' disabled={!canEdit || opening} onClick={() => void startChat(false)}>
        Start issue
      </Chip>
    )
  }
  if (issue.status === 'in_progress') return openChatLink
  if (issue.status === 'done') {
    return (
      <div className='flex shrink-0 items-center gap-2'>
        {openChatLink}
        <Chip variant='primary' disabled={!canEdit || opening} onClick={() => void startChat(true)}>
          Follow up
        </Chip>
      </div>
    )
  }
  return (
    <div className='flex shrink-0 items-center gap-2'>
      {openChatLink}
      <Chip
        variant='outline'
        disabled={!canEdit || opening}
        onClick={() => void sendBackForChanges()}
      >
        Request changes
      </Chip>
      <Chip
        variant='primary'
        disabled={!canEdit || approveIssue.isPending}
        onClick={() => approveIssue.mutate({ workspaceId, key: issue.key })}
      >
        Approve
      </Chip>
    </div>
  )
}
