'use client'

import { Fragment } from 'react'
import { cn } from '@sim/emcn'
import { BubbleChat, Check, CircleAlert, Loader } from '@sim/emcn/icons'
import { ChatTurn } from '@/components/resources/interface-view/components/module-renderer/components/chat-module/components/chat-turn'
import {
  type InterfaceChatStep,
  useInterfaceChat,
} from '@/components/resources/interface-view/components/module-renderer/components/chat-module/hooks/use-interface-chat'
import { ModuleResourcePicker } from '@/components/resources/interface-view/components/module-renderer/components/module-resource-picker'
import { MODULE_GUTTER_X } from '@/components/resources/interface-view/module-chrome'
import { ResourceEmptyState } from '@/components/resources/resource-empty-state'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import type { InterfaceMode, InterfaceModule } from '@/lib/interfaces/types'
import { ChatInput } from '@/app/(interfaces)/chat/components/input/input'
import type { ChatMessage } from '@/app/(interfaces)/chat/components/message/message'
import { useAutoScroll } from '@/hooks/use-auto-scroll'

/**
 * Filler timestamp for the synthesized welcome turn. A turn never renders a
 * timestamp, so this is a module-scope constant rather than a `Date` allocated
 * on every keystroke re-render.
 */
const WELCOME_TIMESTAMP = new Date(0)

/**
 * Attachment budget for a module turn. `/api/workflows/[id]/execute` caps a
 * request body at 10MB and attachments are inlined as base64 (≈ +33%), so
 * 3 x 2MB leaves comfortable headroom for the rest of the payload.
 */
const MODULE_CHAT_MAX_FILE_BYTES = 2 * 1024 * 1024
const MODULE_CHAT_MAX_FILES = 3

export interface ChatModuleProps {
  module: Extract<InterfaceModule, { type: 'chat' }>
  mode: InterfaceMode
  /**
   * Whether this surface is live for the viewer. Sending without it fails at
   * the execute route, so the composer is disabled rather than left live.
   */
  canRun?: boolean
  /** Present only where this module may bind its own workflow — see `ModuleRenderer`. */
  onConfigChange?: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

function StepIcon({ status }: { status: InterfaceChatStep['status'] }) {
  if (status === 'running') return <Loader animate className='size-[14px] shrink-0' />
  if (status === 'failed') {
    return <CircleAlert className='size-[14px] shrink-0 text-[var(--text-error)]' />
  }
  return <Check className='size-[14px] shrink-0' />
}

/**
 * Per-block progress for the turn in flight, rendered above the assistant
 * bubble when the module has `showThinking` enabled.
 */
function ChatThinking({ steps }: { steps: InterfaceChatStep[] }) {
  return (
    <ul className={cn('flex flex-col gap-1 pt-3', MODULE_GUTTER_X)}>
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
 * {@link useInterfaceChat}).
 *
 * Rendering mirrors the Sim chat instead, through the shared renderers in
 * `@/components/chat` (see {@link ChatTurn}): the same markdown pipeline, code
 * highlighting, stream reveal, bubble, and attachment strip. A visitor reading
 * an agent's answer here sees exactly what they would see reading one in the
 * workspace.
 *
 * In `edit` mode — and for a viewer who cannot run the surface — the composer
 * is disabled and no request is ever made; the welcome message still renders so
 * the canvas previews the configured surface.
 *
 * On a public share the same component runs against the token-scoped execute
 * route, which resolves the workflow and the output selection from the stored
 * layout rather than from anything this client sends, and streams back the same
 * typed execution events this client decodes — a different route, deliberately
 * pinned to one wire format.
 */
export function ChatModule({ module, mode, canRun = true, onConfigChange }: ChatModuleProps) {
  const { source } = useResourceOfKind('interface')
  const { workflowId, outputConfigs, showThinking, welcomeMessage } = module.config
  const isEditing = mode === 'edit'
  const isSendDisabled = isEditing || !canRun

  const { messages, steps, isRunning, send, stop } = useInterfaceChat({
    moduleId: module.id,
    workflowId,
    outputConfigs,
    showThinking,
    endpoint:
      source.via === 'share'
        ? `/api/interfaces/public/${source.token}/modules/${module.id}/chat`
        : undefined,
  })
  const { ref: scrollRef } = useAutoScroll(isRunning, { scrollOnMount: true })

  /**
   * Only the workspace arm can tell an unwired module from a wired one by its
   * config: the share arm is addressed by `(token, moduleId)` and carries no
   * workflow id at all, because the server pruned every module a visitor could
   * not run before the layout ever reached this client.
   */
  if (source.via === 'workspace' && !workflowId) {
    if (onConfigChange) {
      return (
        <ModuleResourcePicker
          kind='workflow'
          workspaceId={source.workspaceId}
          onSelect={(next) =>
            onConfigChange(
              module.id,
              { ...module.config, workflowId: next, outputConfigs: [] },
              true
            )
          }
        />
      )
    }
    return <ResourceEmptyState icon={BubbleChat} description='This chat is not available.' />
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
      <div
        ref={scrollRef}
        className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-2 pb-4'
      >
        {turns.length === 0 ? (
          <ResourceEmptyState
            icon={BubbleChat}
            description='Send a message to run this workflow.'
          />
        ) : (
          turns.map((turn, index) => (
            <Fragment key={turn.id}>
              {showSteps && index === turns.length - 1 ? <ChatThinking steps={steps} /> : null}
              <ChatTurn message={turn} />
            </Fragment>
          ))
        )}
      </div>
      {/**
       * The deployed chat's own composer, mounted rather than re-drawn: same
       * rounded surface, same send affordance, same behaviour — so a module and
       * a deployed chat cannot drift apart.
       *
       * Attachments are offered on the workspace arm only. The token-scoped
       * chat route still declares a text-only body, so a share would present an
       * affordance whose files the contract strips — worse than none.
       *
       * The caps are lower than the deployed chat's because attachments travel
       * inline as base64 and `/api/workflows/[id]/execute` caps a body at 10MB;
       * base64 inflates by a third, so this keeps a full turn inside it.
       */}
      <div className={cn('shrink-0 border-[var(--border)] border-t py-2', MODULE_GUTTER_X)}>
        <ChatInput
          onSubmit={(value, _isVoiceInput, files) => send(value, files)}
          isStreaming={isRunning}
          onStopStreaming={stop}
          disabled={isSendDisabled}
          docked={false}
          allowAttachments={source.via === 'workspace'}
          maxFileSizeBytes={MODULE_CHAT_MAX_FILE_BYTES}
          maxFiles={MODULE_CHAT_MAX_FILES}
          placeholder={
            isEditing
              ? 'Chat runs in preview'
              : canRun
                ? 'Enter a message...'
                : 'You do not have access to chat'
          }
        />
      </div>
    </div>
  )
}
