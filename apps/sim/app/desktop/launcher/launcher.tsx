'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { type LauncherTurn, useLauncherChat } from '@/app/desktop/launcher/use-launcher-chat'
import { renderInlineMarkdown } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/inline-markdown'
import {
  type ContentSegment,
  parseSpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkspacesWithMetadata } from '@/hooks/queries/workspace'
import { splitCompleteSentences, toSpeakableText, useSpeakBack } from '@/hooks/use-speak-back'
import { useSpeechToText } from '@/hooks/use-speech-to-text'

const RECENT_CHATS_SHOWN = 5

/** Transcript cap: window max height (600) minus the input bar + padding. */
const TRANSCRIPT_MAX_HEIGHT_PX = 500

function launcherBridge() {
  return typeof window !== 'undefined' ? window.simDesktop?.launcher : undefined
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
  // sendMessage is defined above useSpeakBack; a ref bridges the cancel call
  // so a new turn can stop in-progress read-back without a declaration cycle.
  const cancelSpeakingRef = useRef<() => void>(() => {})
  // submit() is defined above the STT hook; these refs let it stop listening
  // on manual send without a declaration cycle.
  const isListeningRef = useRef(false)
  const rawToggleListeningRef = useRef<() => void>(() => {})

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every turn/working change
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
      // Stop any in-progress read-back before the next turn starts.
      cancelSpeakingRef.current()
      void send(trimmed, workspaceId)
    },
    [workspaceId, send]
  )

  const submit = useCallback(() => {
    if (!draft.trim()) return
    // Manual send ends the listening turn (no automatic turn detection): stop
    // capturing voice the moment the message goes out, then it responds back.
    if (isListeningRef.current) {
      rawToggleListeningRef.current()
    }
    sendMessage(draft)
    setDraft('')
  }, [draft, sendMessage])

  // Voice input: the exact same speech-to-text pipeline as the mothership
  // chat composer (ElevenLabs Scribe via /api/speech/token, gated on the
  // server having the key). The transcript is appended to whatever the user
  // had already typed, captured as a prefix when listening starts.
  const sttPrefixRef = useRef('')
  const {
    isListening,
    isSupported: isSttSupported,
    toggleListening: rawToggleListening,
  } = useSpeechToText({
    onTranscript: (text) => {
      const prefix = sttPrefixRef.current
      setDraft(prefix ? `${prefix} ${text}` : text)
    },
    workspaceId: workspaceId ?? undefined,
  })

  isListeningRef.current = isListening
  rawToggleListeningRef.current = rawToggleListening

  const toggleListening = useCallback(() => {
    if (!isListening) {
      sttPrefixRef.current = draft.trim()
      inputRef.current?.focus()
    }
    rawToggleListening()
  }, [isListening, draft, rawToggleListening])

  // Speak-back: reads assistant replies aloud (OS speech synthesis — like
  // macOS read-back). Enabled by default when the panel is opened via Voice
  // Mode; toggleable from the speaker button.
  const {
    isSupported: isSpeakSupported,
    isSpeaking,
    speak,
    cancel: cancelSpeaking,
  } = useSpeakBack()
  const [speakEnabled, setSpeakEnabled] = useState(false)
  // True when this panel was summoned as Voice Mode (tray → Voice Mode). In
  // voice mode read-back is always on and the text-mode chrome (speaker
  // toggle, Open in Sim) is hidden — it's a dedicated voice surface.
  const [voiceMode, setVoiceMode] = useState(false)
  // Per-assistant-turn read-back progress: how much of the turn's text has
  // already been spoken (offset), keyed by turn id so a new turn resets it.
  const speakProgressRef = useRef<{ turnId: string | null; offset: number }>({
    turnId: null,
    offset: 0,
  })
  cancelSpeakingRef.current = cancelSpeaking

  // Voice Mode summon (tray) enables speak-back and focuses the input so the
  // user can immediately hit the mic.
  useEffect(() => {
    const bridge = launcherBridge()
    if (!bridge) return
    return bridge.onShown(({ voice }) => {
      if (voice) {
        setVoiceMode(true)
        setSpeakEnabled(true)
      }
      inputRef.current?.focus()
    })
  }, [])

  // Conversational read-back: speak the latest assistant turn sentence by
  // sentence AS it streams (queued in useSpeakBack), so the natural voice
  // starts almost immediately instead of after the whole message. Progress
  // is tracked per turn id; on completion any trailing remainder is flushed.
  useEffect(() => {
    if (!speakEnabled) return
    const lastAssistant = [...state.turns].reverse().find((t) => t.role === 'assistant')
    if (!lastAssistant) return

    const progress = speakProgressRef.current
    if (progress.turnId !== lastAssistant.id) {
      speakProgressRef.current = { turnId: lastAssistant.id, offset: 0 }
    }

    const spoken = toSpeakableText(lastAssistant.text)
    const unspoken = spoken.slice(speakProgressRef.current.offset)
    if (!unspoken) return

    if (isStreaming) {
      // Only emit complete sentences mid-stream; hold the trailing fragment.
      const { complete, rest } = splitCompleteSentences(unspoken)
      for (const sentence of complete) speak(sentence)
      if (complete.length > 0) {
        speakProgressRef.current.offset = spoken.length - rest.length
      }
    } else {
      // Turn settled — flush whatever remains (last sentence / no punctuation).
      speak(unspoken)
      speakProgressRef.current.offset = spoken.length
    }
  }, [speakEnabled, isStreaming, state.turns, speak])

  // Stop any read-back when the user starts a new turn or disables speak-back.
  useEffect(() => {
    if (!speakEnabled) cancelSpeaking()
  }, [speakEnabled, cancelSpeaking])

  const toggleSpeak = useCallback(() => {
    setSpeakEnabled((prev) => {
      if (prev) cancelSpeaking()
      return !prev
    })
  }, [cancelSpeaking])

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
            placeholder={
              voiceMode
                ? 'Tap the mic and speak…'
                : hasConversation
                  ? 'Reply…'
                  : 'Ask Sim anything…'
            }
            spellCheck={false}
            className='max-h-40 min-h-10 flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-transparent px-3 py-2 text-[15px] text-[var(--text-primary)] leading-snug outline-none placeholder:text-[var(--text-subtle)] focus:border-[var(--border-1)]'
          />
          {isSpeakSupported && !voiceMode && (
            <div className='shrink-0 pt-1'>
              <SpeakToggle enabled={speakEnabled} speaking={isSpeaking} onToggle={toggleSpeak} />
            </div>
          )}
          {isSttSupported && workspaceId && (
            <div className='shrink-0 pt-1'>
              <MicButton isListening={isListening} onToggle={toggleListening} />
            </div>
          )}
          {hasConversation && !voiceMode && (
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
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only during streaming
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
        // biome-ignore lint/suspicious/noArrayIndexKey: streaming paragraphs are append-only
        <p key={index} className='whitespace-pre-wrap'>
          {renderInlineMarkdown(paragraph)}
        </p>
      ))}
    </div>
  )
}

/**
 * Speaker toggle for read-back. Filled/accented when enabled; a subtle pulse
 * while actively speaking.
 */
function SpeakToggle({
  enabled,
  speaking,
  onToggle,
}: {
  enabled: boolean
  speaking: boolean
  onToggle: () => void
}) {
  return (
    <button
      type='button'
      onClick={onToggle}
      aria-label={enabled ? 'Turn off read-back' : 'Read replies aloud'}
      aria-pressed={enabled}
      className={`flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors ${
        enabled
          ? 'bg-[var(--brand-primary-hex,#701ffc)] text-white'
          : 'text-[var(--text-icon)] hover:bg-[var(--surface-3)]'
      } ${speaking ? 'animate-pulse' : ''}`}
    >
      <svg
        className='h-[16px] w-[16px]'
        viewBox='0 0 16 16'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-hidden='true'
      >
        <path
          d='M8.5 2.5 4.75 5.5H2.5v5h2.25L8.5 13.5v-11z'
          fill='currentColor'
          stroke='currentColor'
          strokeWidth='1'
          strokeLinejoin='round'
        />
        {enabled ? (
          <>
            <path
              d='M11 5.5a3.2 3.2 0 0 1 0 5'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
            <path
              d='M12.6 3.8a5.6 5.6 0 0 1 0 8.4'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
          </>
        ) : (
          <path
            d='m11 6 3 4M14 6l-3 4'
            stroke='currentColor'
            strokeWidth='1.2'
            strokeLinecap='round'
          />
        )}
      </svg>
    </button>
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
