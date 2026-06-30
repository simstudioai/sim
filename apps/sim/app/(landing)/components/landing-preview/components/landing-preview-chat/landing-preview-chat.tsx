'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { LandingPreviewChatInput } from '@/app/(landing)/components/landing-preview/components/landing-preview-chat/chat-input'
import { LandingPreviewChatTitleBar } from '@/app/(landing)/components/landing-preview/components/landing-preview-chat/chat-title-bar'
import type { PreviewChat } from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'
import { useLandingSubmit } from '@/app/(landing)/components/landing-preview/hooks/use-landing-submit'
import { ThinkingLoader } from '@/app/(landing)/components/thinking-loader'

interface LandingPreviewChatProps {
  /** The scripted exchange to play, or `null` to show only the input. */
  chat: PreviewChat | null
  /** Name shown in the chat-switcher breadcrumb chip. */
  chatName: string
  /** Re-runs the reveal timeline whenever it changes (one per staged resource). */
  animationKey: number
}

/** Reveal beats for the scripted conversation, in ms from the step start. */
const THINKING_AT = 480
const ASSISTANT_AT = 1280

/**
 * The Mothership chat pane - the persistent left column of the "chat everywhere"
 * layout. Its title bar carries the chat-switcher breadcrumb (a chat-bubble
 * chip + the active chat's name + chevron) exactly like the real workspace, so
 * the chat reads as the constant that every staged resource hangs off of.
 *
 * On each `animationKey` change it replays a short scripted exchange: the user's
 * request slides in, Sim "thinks" (the cycle loader), then the reply slides in -
 * mirroring the workflow building itself on the staged panel to the right. The
 * reveal is plain state + CSS transition (no layout animation) so it composes
 * under the preview's root `LazyMotion` without pulling in `domMax`.
 *
 * The input is live: submitting stores the prompt and routes to `/signup`, so a
 * visitor's first message survives the auth hop.
 */
export function LandingPreviewChat({ chat, chatName, animationKey }: LandingPreviewChatProps) {
  const submit = useLandingSubmit()
  const [value, setValue] = useState('')
  const [showUser, setShowUser] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)

  useEffect(() => {
    setShowUser(false)
    setShowThinking(false)
    setShowAssistant(false)
    if (!chat) return

    const raf = requestAnimationFrame(() => setShowUser(true))
    const t1 = setTimeout(() => setShowThinking(true), THINKING_AT)
    const t2 = setTimeout(() => {
      setShowThinking(false)
      setShowAssistant(true)
    }, ASSISTANT_AT)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [animationKey, chat])

  const isEmpty = value.trim().length === 0
  const handleSubmit = () => {
    if (isEmpty) return
    submit(value)
  }

  return (
    <div className='flex h-full w-[400px] flex-shrink-0 flex-col bg-[var(--surface-2)]'>
      <LandingPreviewChatTitleBar chatName={chatName} showClose />

      {/* Conversation - bottom-anchored so it rests just above the input. */}
      <div className='flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-3.5 pt-4 pb-1'>
        {chat && (
          <>
            <div
              className={cn(
                'max-w-[85%] self-end rounded-2xl bg-[var(--surface-1)] px-3.5 py-2 text-[13.5px] text-[var(--text-primary)] leading-[1.45] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
                showUser ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
              )}
            >
              {chat.user}
            </div>

            <div className='min-h-[20px] self-start pr-2'>
              {showThinking && <ThinkingLoader size={20} startVariant='corners' />}
              {showAssistant && (
                <p
                  className={cn(
                    'max-w-[92%] text-[13.5px] text-[var(--text-primary)] leading-[1.5] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
                    showAssistant ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'
                  )}
                >
                  {chat.assistant}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Input - live: routes a typed prompt to /signup. */}
      <div className='flex-shrink-0 px-3 pt-2 pb-3'>
        <LandingPreviewChatInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder='Ask Sim anything…'
        />
      </div>
    </div>
  )
}
