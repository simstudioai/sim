'use client'

import { Fragment, useState } from 'react'
import { Chip, ChipTextarea } from '@sim/emcn'
import { ArrowUp, BubbleChat, Check, CircleAlert, Loader, Square } from '@sim/emcn/icons'
import type { InterfaceModule } from '@/lib/interfaces'
import {
  type ChatMessage,
  ClientChatMessage,
} from '@/app/(interfaces)/chat/components/message/message'
import {
  type InterfaceChatStep,
  useInterfaceChat,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/chat-module/hooks/use-interface-chat'
import { ModuleEmptyState } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-empty-state'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { useAutoScroll } from '@/hooks/use-auto-scroll'

/**
 * Filler timestamp for the synthesized welcome turn. `ClientChatMessage` never
 * renders a timestamp, so this is a module-scope constant rather than a `Date`
 * allocated on every keystroke re-render.
 */
const WELCOME_TIMESTAMP = new Date(0)

export interface ChatModuleProps {
  /** Part of the uniform module contract; the chat executes by workflow id alone. */
  workspaceId: string
  /** Part of the uniform module contract; the chat is scoped by module id alone. */
  interfaceId: string
  module: Extract<InterfaceModule, { type: 'chat' }>
  mode: InterfaceMode
  /**
   * Whether the viewer may run the wired workflow. Sending without it fails at
   * the execute route, so the composer is disabled rather than left live.
   */
  canEdit?: boolean
}

function StepIcon({ status }: { status: InterfaceChatStep['status'] }) {
  if (status === 'running') return <Loader animate className='size-[12px] shrink-0' />
  if (status === 'failed') {
    return <CircleAlert className='size-[12px] shrink-0 text-[var(--text-error)]' />
  }
  return <Check className='size-[12px] shrink-0' />
}

/**
 * Per-block progress for the turn in flight, rendered above the assistant
 * bubble when the module has `showThinking` enabled.
 */
function ChatThinking({ steps }: { steps: InterfaceChatStep[] }) {
  return (
    <ul className='flex flex-col gap-1 px-4 pt-3'>
      {steps.map((step) => (
        <li
          key={step.id}
          className='flex items-center gap-1.5 text-[var(--text-muted)] text-caption'
        >
          <StepIcon status={step.status} />
          <span className='min-w-0 truncate'>{step.label}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Chat surface for one interface module: sends a message to the wired
 * workspace workflow and renders the block outputs the module selected.
 *
 * Execution mirrors a chat deployment exactly — same execute route, same
 * `triggerType: 'chat'` payload, same `selectedOutputs` serialization (see
 * {@link useInterfaceChat}) — and messages render through the deployed chat's
 * own `ClientChatMessage`, so markdown, JSON output, file downloads, and the
 * copy affordance all behave identically.
 *
 * In `edit` mode — and for a viewer who cannot run the workflow — the composer
 * is disabled and no request is ever made; the welcome message still renders so
 * the canvas previews the configured surface.
 */
export function ChatModule({ module, mode, canEdit = true }: ChatModuleProps) {
  const { workflowId, outputConfigs, showThinking, welcomeMessage } = module.config
  const isEditing = mode === 'edit'
  const isSendDisabled = isEditing || !canEdit

  const { messages, steps, isRunning, send, stop } = useInterfaceChat({
    moduleId: module.id,
    workflowId,
    outputConfigs,
    showThinking,
  })
  const { ref: scrollRef } = useAutoScroll(isRunning, { scrollOnMount: true })
  const [draft, setDraft] = useState('')

  function submit() {
    const value = draft.trim()
    if (!value || isRunning || isSendDisabled) return
    setDraft('')
    send(value)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  if (!workflowId) {
    return (
      <ModuleEmptyState
        icon={BubbleChat}
        message={
          isEditing ? 'Connect a workflow to start chatting.' : 'This chat is not available.'
        }
      />
    )
  }

  const welcomeTurn: ChatMessage | null = welcomeMessage.trim()
    ? {
        id: 'welcome',
        content: welcomeMessage,
        type: 'assistant',
        timestamp: WELCOME_TIMESTAMP,
        isInitialMessage: true,
      }
    : null
  const turns = welcomeTurn ? [welcomeTurn, ...messages] : messages
  const showSteps = showThinking && steps.length > 0

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        {turns.length === 0 ? (
          <ModuleEmptyState icon={BubbleChat} message='Send a message to run this workflow.' />
        ) : (
          turns.map((turn, index) => (
            <Fragment key={turn.id}>
              {showSteps && index === turns.length - 1 ? <ChatThinking steps={steps} /> : null}
              <ClientChatMessage message={turn} />
            </Fragment>
          ))
        )}
      </div>
      <div className='flex items-end gap-2 border-[var(--border)] border-t p-2'>
        <ChipTextarea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isEditing
              ? 'Chat runs in preview'
              : canEdit
                ? 'Send a message'
                : 'You need edit access to chat'
          }
          disabled={isSendDisabled}
          aria-label='Message'
          className='min-w-0 flex-1'
        />
        {isRunning ? (
          <Chip
            flush
            variant='primary'
            leftIcon={Square}
            aria-label='Stop generating'
            onClick={stop}
          />
        ) : (
          <Chip
            flush
            variant='primary'
            leftIcon={ArrowUp}
            aria-label='Send message'
            disabled={isSendDisabled || draft.trim().length === 0}
            onClick={submit}
          />
        )}
      </div>
    </div>
  )
}
