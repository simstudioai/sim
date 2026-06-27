'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Check,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Duplicate,
  ThumbsDown,
  ThumbsUp,
  Tooltip,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { useSubmitCopilotFeedback } from '@/hooks/queries/copilot-feedback'
import { useForkMothershipChat } from '@/hooks/queries/mothership-chats'
import { useFolderStore } from '@/stores/folders/store'

const SPECIAL_TAGS = 'thinking|options|usage_upgrade|credential|mothership-error|file'

function toPlainText(raw: string): string {
  return (
    raw
      // Strip special tags and their contents
      .replace(new RegExp(`<\\/?(${SPECIAL_TAGS})(?:>[\\s\\S]*?<\\/(${SPECIAL_TAGS})>|>)`, 'g'), '')
      // Strip markdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{3}[\s\S]*?`{3}/g, '')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[>\-*]\s+/gm, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      // Normalize whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

const ICON_CLASS = 'size-[14px]'
const BUTTON_CLASS =
  'flex size-[26px] items-center justify-center rounded-[6px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-none'

interface MessageActionsProps {
  content: string
  userQuery?: string
  requestId?: string
  messageId?: string
}

export const MessageActions = memo(function MessageActions({
  content,
  userQuery,
  requestId,
  messageId,
}: MessageActionsProps) {
  const t = useTranslations('auto')
  const router = useRouter()
  const params = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()
  const [copied, setCopied] = useState(false)
  const [copiedRequestId, setCopiedRequestId] = useState(false)
  const [pendingFeedback, setPendingFeedback] = useState<'up' | 'down' | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const resetTimeoutRef = useRef<number | null>(null)
  const requestIdTimeoutRef = useRef<number | null>(null)
  const submitFeedback = useSubmitCopilotFeedback()
  const forkChat = useForkMothershipChat(params.workspaceId)

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
      if (requestIdTimeoutRef.current !== null) {
        window.clearTimeout(requestIdTimeoutRef.current)
      }
    }
  }, [])

  const copyToClipboard = async () => {
    if (!content) return
    const text = toPlainText(content)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
      resetTimeoutRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const copyRequestId = async () => {
    if (!requestId) return
    try {
      await navigator.clipboard.writeText(requestId)
      setCopiedRequestId(true)
      if (requestIdTimeoutRef.current !== null) {
        window.clearTimeout(requestIdTimeoutRef.current)
      }
      requestIdTimeoutRef.current = window.setTimeout(() => setCopiedRequestId(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const handleFeedbackClick = (type: 'up' | 'down') => {
    if (chatId && userQuery) {
      setPendingFeedback(type)
      setFeedbackText('')
      setCopiedRequestId(false)
    }
  }

  const handleSubmitFeedback = () => {
    if (!pendingFeedback || !chatId || !userQuery) return
    const text = feedbackText.trim()
    if (!text) {
      setPendingFeedback(null)
      setFeedbackText('')
      return
    }
    submitFeedback.mutate({
      chatId,
      userQuery,
      agentResponse: content,
      isPositiveFeedback: pendingFeedback === 'up',
      feedback: text,
    })
    setPendingFeedback(null)
    setFeedbackText('')
  }

  const handleModalClose = (open: boolean) => {
    if (!open) {
      setPendingFeedback(null)
      setFeedbackText('')
      setCopiedRequestId(false)
    }
  }

  const handleFork = async () => {
    if (!chatId || !messageId || forkChat.isPending) return
    try {
      const result = await forkChat.mutateAsync({ chatId, upToMessageId: messageId })
      useFolderStore.getState().clearChatSelection()
      router.push(`/workspace/${params.workspaceId}/chat/${result.id}`)
    } catch {
      toast.error('Failed to fork chat')
    }
  }

  const hasContent = Boolean(content)
  const canSubmitFeedback = Boolean(chatId && userQuery)
  const canFork = false
  if (!hasContent && !canSubmitFeedback && !canFork) return null

  return (
    <>
      <div className='flex items-center gap-0.5'>
        {hasContent && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                aria-label={t('copy_message')}
                onClick={copyToClipboard}
                className={BUTTON_CLASS}
              >
                {copied ? <Check className={ICON_CLASS} /> : <Duplicate className={ICON_CLASS} />}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {copied ? 'Copied message' : 'Copy message'}
            </Tooltip.Content>
          </Tooltip.Root>
        )}
        {canSubmitFeedback && (
          <>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  aria-label={t('like')}
                  onClick={() => handleFeedbackClick('up')}
                  className={BUTTON_CLASS}
                >
                  <ThumbsUp className={ICON_CLASS} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>{t('good_response')}</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  aria-label={t('dislike')}
                  onClick={() => handleFeedbackClick('down')}
                  className={BUTTON_CLASS}
                >
                  <ThumbsDown className={ICON_CLASS} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>{t('bad_response')}</Tooltip.Content>
            </Tooltip.Root>
          </>
        )}
        {canFork && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                aria-label={t('fork_from_here')}
                onClick={handleFork}
                disabled={forkChat.isPending}
                className={cn(BUTTON_CLASS, forkChat.isPending && 'cursor-not-allowed opacity-50')}
              >
                <GitBranch className={ICON_CLASS} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{t('fork_from_here')}</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>

      <ChipModal
        open={pendingFeedback !== null}
        onOpenChange={handleModalClose}
        srTitle='Give feedback'
      >
        <ChipModalHeader onClose={() => handleModalClose(false)}>
          {t('give_feedback')}
        </ChipModalHeader>
        <ChipModalBody>
          <div className='flex items-start justify-between gap-2 px-2'>
            <p className='font-medium text-[var(--text-secondary)] text-sm'>
              {pendingFeedback === 'up' ? 'What did you like?' : 'What could be improved?'}
            </p>
            {pendingFeedback === 'down' && requestId && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type='button'
                    aria-label={t('copy_request_id')}
                    onClick={copyRequestId}
                    className='flex size-[22px] shrink-0 items-center justify-center rounded-full text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-none'
                  >
                    {copiedRequestId ? (
                      <Check className='size-[14px]' />
                    ) : (
                      <Duplicate className='size-[14px]' />
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>
                  {copiedRequestId ? 'Copied request ID' : 'Copy request ID'}
                </Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>
          <ChipModalField
            type='textarea'
            title={t('feedback')}
            value={feedbackText}
            onChange={setFeedbackText}
            rows={6}
            minHeight={140}
            resizable
            placeholder={
              pendingFeedback === 'up'
                ? 'Tell us what was helpful...'
                : 'Tell us what went wrong...'
            }
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => handleModalClose(false)}
          primaryAction={{
            label: 'Submit',
            onClick: handleSubmitFeedback,
          }}
        />
      </ChipModal>
    </>
  )
})
