'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { getDesktopBridge } from '@/lib/desktop'
import { type LauncherTurn, useLauncherChat } from '@/app/desktop/launcher/use-launcher-chat'
import { renderInlineMarkdown } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/inline-markdown'
import {
  type ContentSegment,
  parseSpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkspacesWithMetadata } from '@/hooks/queries/workspace'

const RECENT_CHATS_SHOWN = 5

/** Transcript cap: window max height (600) minus the input bar + padding. */
const TRANSCRIPT_MAX_HEIGHT_PX = 500

function launcherBridge() {
  return getDesktopBridge()?.launcher
}

/**
 * Quick Ask panel UI. Idle state shows a prompt input, workspace picker, and
 * recent chats; submitting streams the response inline (text + suggested
 * options) with a one-line working indicator and an Open in Sim escape hatch
 * for anything that needs the full app.
 */
export function Launcher() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className='min-h-24 bg-[var(--surface-1)]' />
  }
  if (!launcherBridge()) {
    return (
      <Shell>
        <p className='px-4 py-8 text-center text-[var(--text-muted)] text-sm'>
          Quick Ask is part of the Sim desktop app. Download it at sim.ai.
        </p>
      </Shell>
    )
  }
  return <LauncherPanel />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col bg-[var(--surface-1)] text-[var(--text-primary)]'>{children}</div>
  )
}

function LauncherPanel() {
  const { data: session, isPending: isSessionPending } = useSession()
  const isAuthenticated = !isSessionPending && Boolean(session?.user)
  const { data: workspacesData } = useWorkspacesWithMetadata(isAuthenticated)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const { state, send, reset } = useLauncherChat()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const workspaces = workspacesData?.workspaces ?? []
  const workspaceId = useMemo(() => {
    if (selectedWorkspaceId && workspaces.some((w) => w.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }
    const recent = WorkspaceRecencyStorage.getMostRecent()
    if (recent && workspaces.some((w) => w.id === recent)) {
      return recent
    }
    const lastActive = workspacesData?.lastActiveWorkspaceId
    if (lastActive && workspaces.some((w) => w.id === lastActive)) {
      return lastActive
    }
    return workspaces[0]?.id ?? null
  }, [selectedWorkspaceId, workspaces, workspacesData?.lastActiveWorkspaceId])

  const isStreaming = state.status === 'streaming'
  const hasConversation = state.turns.length > 0

  const { data: recentChats } = useMothershipChats(
    !hasConversation && workspaceId ? workspaceId : undefined
  )

  /** Each summon starts fresh: clear any finished conversation, focus input. */
  useEffect(() => {
    const bridge = launcherBridge()
    if (!bridge) return
    return bridge.onShown(() => {
      if (!isStreaming) {
        reset()
        setDraft('')
      }
      inputRef.current?.focus()
    })
  }, [reset, isStreaming])

  useEffect(() => {
    inputRef.current?.focus()
  }, [isAuthenticated])

  /**
   * Keep the panel window sized to the content (main process clamps). The
   * root is intentionally NOT viewport-capped: its natural height IS the
   * content height, so the ResizeObserver fires as content grows and the
   * window follows. Internal scrolling only happens inside the transcript,
   * which carries its own fixed max-height.
   */
  useEffect(() => {
    const root = rootRef.current
    const bridge = launcherBridge()
    if (!root || !bridge) return
    const report = () => bridge.resize(Math.ceil(root.getBoundingClientRect().height))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  /** Pin the transcript to the latest content while a response streams. */
  useEffect(() => {
    const el = transcriptRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [state.turns, state.working])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        launcherBridge()?.close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !workspaceId) return
      void send(trimmed, workspaceId)
    },
    [workspaceId, send]
  )

  const submit = useCallback(() => {
    if (!draft.trim()) return
    sendMessage(draft)
    setDraft('')
  }, [draft, sendMessage])

  // Auto-grow the input to fit its content (up to the max height) so a
  // multi-line transcript is never clipped — the panel window follows via its
  // ResizeObserver.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  const openInSim = useCallback(() => {
    if (!workspaceId) return
    launcherBridge()?.openChat({
      workspaceId,
      ...(state.chatId ? { chatId: state.chatId } : {}),
    })
  }, [workspaceId, state.chatId])

  if (!isSessionPending && !session?.user) {
    return (
      <Shell>
        <div className='flex flex-col items-center gap-3 px-4 py-8'>
          <p className='text-[var(--text-muted)] text-sm'>Sign in to Sim to use Quick Ask.</p>
          <button
            type='button'
            className='rounded-[8px] bg-[var(--brand-primary-hex,#701ffc)] px-3 py-1.5 font-medium text-sm text-white'
            onClick={() => launcherBridge()?.openApp()}
          >
            Open Sim
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div ref={rootRef} className='flex flex-col'>
        <div className='flex items-start gap-2 px-4 pt-3 pb-2'>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={hasConversation ? 'Reply…' : 'Ask Sim anything…'}
            spellCheck={false}
            className='max-h-40 min-h-10 flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-transparent px-3 py-2 text-[15px] text-[var(--text-primary)] leading-snug outline-none placeholder:text-[var(--text-subtle)] focus:border-[var(--border-1)]'
          />
          {hasConversation && (
            <button
              type='button'
              onClick={openInSim}
              className='shrink-0 self-start rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 font-medium text-[var(--text-secondary)] text-xs hover:bg-[var(--surface-3)]'
            >
              Open in Sim
            </button>
          )}
        </div>

        {!hasConversation && (
          <IdleContent
            workspaces={workspaces.map(({ id, name }) => ({ id, name }))}
            workspaceId={workspaceId}
            onSelectWorkspace={setSelectedWorkspaceId}
            recentChats={(recentChats ?? []).slice(0, RECENT_CHATS_SHOWN)}
            onOpenChat={(chatId) => {
              if (workspaceId) {
                launcherBridge()?.openChat({ workspaceId, chatId })
              }
            }}
          />
        )}

        {hasConversation && (
          <div
            ref={transcriptRef}
            className='space-y-3 overflow-y-auto px-4 pb-3'
            style={{ maxHeight: TRANSCRIPT_MAX_HEIGHT_PX }}
          >
            {state.turns.map((turn) =>
              turn.role === 'user' ? (
                <p key={turn.id} className='font-medium text-[var(--text-primary)] text-sm'>
                  {turn.text}
                </p>
              ) : (
                <AssistantMessage
                  key={turn.id}
                  turn={turn}
                  isStreaming={isStreaming}
                  onReply={sendMessage}
                  onOpenInSim={openInSim}
                />
              )
            )}
            {state.working && (
              <p className='animate-pulse text-[var(--text-muted)] text-sm'>{state.working}</p>
            )}
            {state.status === 'needs-app' && (
              <HandoffRow label='This needs the full app to continue.' onOpen={openInSim} />
            )}
            {state.status === 'error' && (
              <p className='text-red-500 text-sm'>{state.error ?? 'Something went wrong.'}</p>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

interface AssistantMessageProps {
  turn: LauncherTurn
  isStreaming: boolean
  onReply: (message: string) => void
  onOpenInSim: () => void
}

/**
 * Renders one assistant turn: markdown-lite text plus the inline special tags
 * the panel supports natively (`<options>` as clickable suggestions,
 * `<mothership-error>` as error text). Tags that require the full app's
 * context collapse into an Open in Sim row. While streaming, partial tags are
 * suppressed instead of flashing raw JSON.
 */
function AssistantMessage({ turn, isStreaming, onReply, onOpenInSim }: AssistantMessageProps) {
  const parsed = useMemo(() => parseSpecialTags(turn.text, isStreaming), [turn.text, isStreaming])
  if (!turn.text) return null

  return (
    <div className='space-y-2'>
      {parsed.segments.map((segment, index) => (
        <SegmentView
          key={index}
          segment={segment}
          onOptionSelect={onReply}
          onOpenInSim={onOpenInSim}
        />
      ))}
      {parsed.hasPendingTag && isStreaming && (
        <p className='animate-pulse text-[var(--text-muted)] text-sm'>Thinking…</p>
      )}
    </div>
  )
}

interface SegmentViewProps {
  segment: ContentSegment
  onOptionSelect: (title: string) => void
  onOpenInSim: () => void
}

function SegmentView({ segment, onOptionSelect, onOpenInSim }: SegmentViewProps) {
  switch (segment.type) {
    case 'text':
      return <AssistantText text={segment.content} />
    case 'thinking':
      return null
    case 'options':
      return (
        <div className='overflow-hidden rounded-[10px] border border-[var(--border)]'>
          {Object.entries(segment.data).map(([key, option], index) => (
            <button
              key={key}
              type='button'
              onClick={() => onOptionSelect(option.title)}
              className={`flex w-full items-baseline gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)] ${
                index > 0 ? 'border-[var(--border)] border-t' : ''
              }`}
            >
              <span className='shrink-0 text-[var(--text-subtle)] text-xs'>{index + 1}</span>
              <span className='min-w-0'>
                <span className='block truncate font-medium text-[var(--text-primary)] text-sm'>
                  {option.title}
                </span>
                {option.description && (
                  <span className='block truncate text-[var(--text-muted)] text-xs'>
                    {option.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )
    case 'mothership-error':
      return <p className='text-[var(--text-secondary)] text-sm italic'>{segment.data.message}</p>
    case 'workspace_resource':
      return (
        <span className='font-medium text-[var(--text-primary)] text-sm'>
          {segment.data.title ?? segment.data.type}
        </span>
      )
    default:
      // credential, usage_upgrade — interactive widgets that need the full app.
      return <HandoffRow label='Continue in Sim to complete this step.' onOpen={onOpenInSim} />
  }
}

function AssistantText({ text }: { text: string }) {
  const trimmed = text.trim()
  if (!trimmed) return null
  return (
    <div className='space-y-2 text-[var(--text-secondary)] text-sm leading-relaxed'>
      {trimmed.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className='whitespace-pre-wrap'>
          {renderInlineMarkdown(paragraph)}
        </p>
      ))}
    </div>
  )
}

function HandoffRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div className='flex items-center justify-between gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2'>
      <span className='text-[var(--text-muted)] text-sm'>{label}</span>
      <button
        type='button'
        onClick={onOpen}
        className='shrink-0 rounded-[8px] bg-[var(--brand-primary-hex,#701ffc)] px-2.5 py-1.5 font-medium text-white text-xs'
      >
        Open in Sim
      </button>
    </div>
  )
}

interface IdleContentProps {
  workspaces: { id: string; name: string }[]
  workspaceId: string | null
  onSelectWorkspace: (id: string) => void
  recentChats: { id: string; name: string }[]
  onOpenChat: (chatId: string) => void
}

function IdleContent({
  workspaces,
  workspaceId,
  onSelectWorkspace,
  recentChats,
  onOpenChat,
}: IdleContentProps) {
  return (
    <div className='px-4 pb-3'>
      {recentChats.length > 0 && (
        <div className='mt-1'>
          <p className='px-1 pb-1 text-[11px] text-[var(--text-subtle)] uppercase tracking-wide'>
            Recent chats
          </p>
          <div className='space-y-0.5'>
            {recentChats.map((chat) => (
              <button
                key={chat.id}
                type='button'
                onClick={() => onOpenChat(chat.id)}
                className='block w-full truncate rounded-[8px] px-2 py-1.5 text-left text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)]'
              >
                {chat.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {workspaces.length > 1 && (
        <div className='mt-2 flex items-center justify-end gap-1.5'>
          <span className='text-[11px] text-[var(--text-subtle)]'>Workspace</span>
          <select
            value={workspaceId ?? ''}
            onChange={(event) => onSelectWorkspace(event.target.value)}
            className='max-w-44 rounded-[6px] border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-[var(--text-secondary)] text-xs outline-none'
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
