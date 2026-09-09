'use client'

import { useRef, useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Mic, Paperclip, Plus, Slash, X } from '@sim/emcn/icons'
import { HeroChatReply } from '@/app/(landing)/components/hero/components/hero-chat-loop/hero-chat-reply'
import { HeroToolCallItem } from '@/app/(landing)/components/hero/components/hero-chat-loop/hero-tool-call-item'
import { HeroChatWelcome } from '@/app/(landing)/components/hero/components/hero-chat-welcome'
import { HERO_TOOLTIP_OFFSET } from '@/app/(landing)/components/hero/components/hero-platform-loop/sidebar-hotspots'
import { useElapsedReveal } from '@/app/(landing)/hooks/use-elapsed-reveal'
import {
  type AgentGroupItem,
  AgentGroupView,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import {
  parseQuestionAnswerMessage,
  QuestionDisplay,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import type { QuestionItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { PendingTagIndicator } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/pending-tag-indicator'
import { SendButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/send-button/send-button'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** Word-reveal cadence for the streamed reply. */
const STREAM_WORD_MS = 55
const WORKFLOW_AGENT_ITEMS: AgentGroupItem[] = [
  {
    type: 'tool',
    data: {
      id: 'hero-read-slack',
      toolName: 'call_integration_tool',
      displayTitle: 'Read Slack',
      status: ToolCallStatus.success,
      params: { toolId: 'slack_get_channel_history' },
    },
  },
  {
    type: 'tool',
    data: {
      id: 'hero-create-workflow',
      toolName: 'edit_workflow',
      displayTitle: 'Creating Lead enrichment',
      status: ToolCallStatus.success,
    },
  },
  {
    type: 'tool',
    data: {
      id: 'hero-read-table',
      toolName: 'read',
      displayTitle: 'Reading Tables',
      status: ToolCallStatus.success,
      params: { path: 'components/blocks/table.json' },
    },
  },
  {
    type: 'text',
    content: 'Connected the Slack and Tables steps',
  },
  {
    type: 'tool',
    data: {
      id: 'hero-edit-workflow',
      toolName: 'edit_workflow',
      displayTitle: 'Editing workflow',
      status: ToolCallStatus.success,
    },
  },
]

const WORKFLOW_AGENT_BUILDING_ITEMS: AgentGroupItem[] = WORKFLOW_AGENT_ITEMS.map((item) => {
  if (item.type !== 'tool' || item.data.id !== 'hero-edit-workflow') return item
  return { ...item, data: { ...item.data, status: ToolCallStatus.executing } }
})

const SIM_ITEMS: AgentGroupItem[] = [
  {
    type: 'tool',
    data: {
      id: 'hero-read-workflow',
      toolName: 'read',
      displayTitle: 'Reading workflow',
      status: ToolCallStatus.success,
      params: { path: 'workflows/Lead%20enrichment/state.json' },
    },
  },
]

const FOLLOW_UP_QUESTION: QuestionItem[] = [
  {
    type: 'single_select',
    prompt: 'What would you like to do next?',
    options: [
      { id: 'test', label: 'Run a test with a sample lead' },
      { id: 'deploy', label: 'Deploy the workflow' },
    ],
  },
]

/** Where the chat pane is within one loop pass. */
export type HeroChatPhase =
  | 'idle'
  | 'compose'
  | 'user'
  | 'thinking'
  | 'dispatching'
  | 'building'
  | 'reply'

interface HeroChatLoopProps {
  /** Current phase, driven by the landing-safe product adapter. */
  phase: HeroChatPhase
  /** True during a visual reset. */
  fading: boolean
  userMessage: string
  replyMessage: string
  composerValue: string
  isSending: boolean
  onComposerValueChange: (value: string) => void
  onComposerFocus?: () => void
  showWelcome?: boolean
  onOpenWorkflowResource: () => void
  onFollowUpSelect: (value: string) => void
  onSubmit: () => void
  onStopGeneration: () => void
}

/**
 * A landing-safe adapter for Sim's real Mothership chat presentation. It
 * preserves the production composer dimensions and send control while all
 * messages, attachments, follow-ups, and workflow-build state remain local to
 * the browser preview.
 */
export function HeroChatLoop({
  phase,
  fading,
  userMessage,
  replyMessage,
  composerValue,
  isSending,
  onComposerValueChange,
  onComposerFocus,
  showWelcome = false,
  onOpenWorkflowResource,
  onFollowUpSelect,
  onSubmit,
  onStopGeneration,
}: HeroChatLoopProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const showUser = phase !== 'idle' && phase !== 'compose'
  const welcome = showWelcome && !showUser
  const showThinking = phase === 'thinking' || phase === 'dispatching'
  const showBuilding = phase === 'building'
  const showReply = phase === 'reply'
  const replyWords = replyMessage.match(/\S+\s*/g) ?? []
  const replyWordCount = replyWords.length
  const revealedWords = useElapsedReveal(showReply, STREAM_WORD_MS, replyWordCount)
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null)

  const replyComplete = revealedWords >= replyWordCount
  const canSubmit = composerValue.trim().length > 0 || attachedFileName !== null

  const updateComposer = (value: string) => {
    onComposerValueChange(value)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const submitComposer = () => {
    if (!canSubmit) return
    onSubmit()
    setAttachedFileName(null)
  }

  const selectFollowUp = (message: string) => {
    const answer = parseQuestionAnswerMessage(FOLLOW_UP_QUESTION, message)?.[0]
    onFollowUpSelect(answer ?? message)
  }

  return (
    <div
      className='relative flex h-full w-full flex-col bg-[var(--bg)]'
      data-chat-view={welcome ? 'welcome' : 'conversation'}
      data-chat-phase={phase}
    >
      <div
        inert={welcome}
        aria-hidden={welcome}
        className={cn(
          'mx-auto flex min-h-0 w-full max-w-chat flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden px-6 pt-4 transition-opacity duration-300 ease-out [scrollbar-gutter:stable_both-edges] motion-reduce:transition-none',
          showWelcome && (attachedFileName ? 'mb-[144px]' : 'mb-[110px]'),
          fading || welcome ? 'opacity-0' : 'opacity-100'
        )}
      >
        <div
          className={cn(
            'max-w-[70%] shrink-0 self-end overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2 text-[var(--text-primary)] text-sm leading-5 transition-[opacity,transform] duration-200 ease-out',
            showUser ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          )}
        >
          {userMessage}
        </div>

        <div
          className={cn(
            'flex flex-col gap-[10px] transition-opacity duration-200 ease-out',
            showThinking || showBuilding || showReply ? 'opacity-100' : 'opacity-0'
          )}
        >
          {showThinking && (
            <PendingTagIndicator label={phase === 'dispatching' ? 'Dispatching…' : 'Thinking…'} />
          )}
          {showBuilding && (
            <AgentGroupView
              ToolCallComponent={HeroToolCallItem}
              agentName='workflow'
              agentLabel='Workflow Agent'
              items={WORKFLOW_AGENT_BUILDING_ITEMS}
              isStreaming
              isCurrentSection
              isLaneOpen
              defaultExpanded
              autoScrollActivity={false}
            />
          )}
          {showReply && (
            <>
              <AgentGroupView
                ToolCallComponent={HeroToolCallItem}
                agentName='workflow'
                agentLabel='Workflow Agent'
                items={WORKFLOW_AGENT_ITEMS}
                defaultExpanded
              />
              <AgentGroupView
                ToolCallComponent={HeroToolCallItem}
                agentName='mothership'
                agentLabel='Sim'
                items={SIM_ITEMS}
                defaultExpanded
              />
              <HeroChatReply
                content={replyComplete ? replyMessage : replyWords.slice(0, revealedWords).join('')}
                onOpenWorkflowResource={onOpenWorkflowResource}
              />
              {replyComplete && (
                <QuestionDisplay
                  data={FOLLOW_UP_QUESTION}
                  onSelect={selectFollowUp}
                  onDismiss={() => undefined}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div
        className={cn(
          'mx-auto w-[calc(100%-48px)] max-w-chat rounded-2xl border border-[var(--border)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
          showWelcome
            ? 'absolute inset-x-0 transition-[bottom,transform] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none max-sm:w-[calc(100%-24px)]'
            : 'mb-4 shrink-0',
          showWelcome &&
            (welcome
              ? 'bottom-[52%] translate-y-1/2 shadow-xs max-sm:bottom-[42%]'
              : 'bottom-4 translate-y-0')
        )}
      >
        {showWelcome && <HeroChatWelcome visible={welcome} onSelect={updateComposer} />}
        {attachedFileName && (
          <div className='mb-1 flex w-fit max-w-full items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] py-1 pr-1 pl-2 text-[var(--text-body)] text-xs'>
            <Paperclip className='size-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='truncate'>{attachedFileName}</span>
            <Button
              type='button'
              variant='ghost'
              aria-label='Remove attachment'
              onClick={() => setAttachedFileName(null)}
              className='size-[22px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
            >
              <X className='size-[12px] text-[var(--text-icon)]' />
            </Button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={composerValue}
          rows={welcome ? 2 : 1}
          onFocus={onComposerFocus}
          aria-label='Ask Sim'
          placeholder='Ask Sim to '
          onChange={(event) => onComposerValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitComposer()
            }
          }}
          className={cn(
            'm-0 block max-h-[96px] w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 font-body text-[14px] text-[var(--text-primary)] leading-[24px] tracking-[-0.015em] outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0',
            welcome ? 'min-h-[56px]' : 'min-h-[32px]'
          )}
        />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-1'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => updateComposer(`${composerValue}@Knowledge Base `)}
                  aria-label='Add resources'
                  className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
                >
                  <Plus className='size-[16px] text-[var(--text-icon)]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content offset={HERO_TOOLTIP_OFFSET}>Add resources</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => fileInputRef.current?.click()}
                  aria-label='Attach file'
                  className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
                >
                  <Paperclip className='size-[16px] text-[var(--text-icon)]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content offset={HERO_TOOLTIP_OFFSET}>Attach file</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => updateComposer(`${composerValue}/`)}
                  aria-label='Skills'
                  className='size-[28px] rounded-full p-0 hover-hover:bg-[var(--surface-hover)]'
                >
                  <Slash className='size-[16px] text-[var(--text-icon)]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content offset={HERO_TOOLTIP_OFFSET}>Skills</Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div className='flex items-center gap-1.5'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span>
                  <Button
                    type='button'
                    variant='ghost'
                    disabled
                    aria-label='Voice input requires the signed-in workspace'
                    className='size-[28px] rounded-full p-0'
                  >
                    <Mic className='size-[16px] text-[var(--text-icon)]' />
                  </Button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content offset={HERO_TOOLTIP_OFFSET}>
                Voice input is available in the workspace
              </Tooltip.Content>
            </Tooltip.Root>
            <SendButton
              isSending={isSending}
              canSubmit={canSubmit}
              onSubmit={submitComposer}
              onStopGeneration={onStopGeneration}
            />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type='file'
          className='hidden'
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setAttachedFileName(file.name)
            if (!composerValue.trim()) updateComposer(`Review ${file.name}`)
          }}
        />
      </div>
    </div>
  )
}
