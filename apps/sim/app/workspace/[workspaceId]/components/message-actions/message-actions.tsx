'use client'

import { memo, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ClipboardContent,
  cn,
  Duplicate,
  Split,
  ThumbsDown,
  ThumbsUp,
  Tooltip,
  toast,
  useCopyToClipboard,
} from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { isLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { useSubmitCopilotFeedback } from '@/hooks/queries/copilot-feedback'
import { useForkMothershipChat } from '@/hooks/queries/mothership-chats'
import { useFolderStore } from '@/stores/folders/store'

const ICON_CLASS = 'size-[14px]'
const BUTTON_CLASS =
  'flex size-[26px] items-center justify-center rounded-[6px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-hidden'

interface MessageActionsProps {
  content: string
  getCopyContent?: () => string
  hasCopyContent?: boolean
  prepareContentForCopy?: (content: string) => ClipboardContent
  userQuery: string | undefined
  requestId?: string
  messageId?: string
}

export const MessageActions = memo(function MessageActions({
  content,
  getCopyContent,
  hasCopyContent,
  prepareContentForCopy,
  userQuery,
  requestId,
  messageId,
}: MessageActionsProps) {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  const owner = params.organizationId
    ? { organizationId: params.organizationId }
    : params.workspaceId
  const { chatId } = useChatSurface()
  const { copied, copy: copyMessage } = useCopyToClipboard({ resetMs: 1500 })
  const [copiedRequestId, setCopiedRequestId] = useState(false)
  const [pendingFeedback, setPendingFeedback] = useState<'up' | 'down' | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const requestIdTimeoutRef = useRef<number | null>(null)
  const submitFeedback = useSubmitCopilotFeedback()
  const forkChat = useForkMothershipChat(owner)

  useEffect(() => {
    return () => {
      if (requestIdTimeoutRef.current !== null) {
        window.clearTimeout(requestIdTimeoutRef.current)
      }
    }
  }, [])

  const copyToClipboard = () => {
    const contentToCopy = getCopyContent?.() ?? content
    if (!contentToCopy) return
    const copyContent = prepareContentForCopy?.(contentToCopy) ?? contentToCopy
    if (typeof copyContent === 'string' && !copyContent) return
    void copyMessage(copyContent)
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
    if (!owner || !chatId || !messageId || forkChat.isPending) return
    try {
      const result = await forkChat.mutateAsync({ chatId, upToMessageId: messageId })
      if (result.failedFileCopies) {
        toast.warning(
          `${result.failedFileCopies} file${result.failedFileCopies === 1 ? '' : 's'} could not be copied to the fork`
        )
      }
      if (params.organizationId) {
        router.push(organizationRoutes(params.organizationId).chat(result.id))
      } else {
        useFolderStore.getState().clearChatSelection()
        router.push(`/workspace/${params.workspaceId}/chat/${result.id}`)
      }
    } catch {
      toast.error('Failed to fork chat')
    }
  }

  const canCopyContent = hasCopyContent ?? Boolean(content)
  const canSubmitFeedback = Boolean(chatId && userQuery)
  // A live (just-streamed) assistant message carries a synthetic id that the
  // persisted transcript doesn't know — forking it would 400. The button
  // appears once the transcript refetch swaps in the persisted message id.
  const canFork = Boolean(owner && chatId && messageId && !isLiveAssistantMessageId(messageId))
  if (!canCopyContent && !canSubmitFeedback && !canFork) return null

  return (
    <>
      <div className='flex items-center gap-0.5'>
        {canCopyContent && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                aria-label='Copy message'
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
                  aria-label='Like'
                  onClick={() => handleFeedbackClick('up')}
                  className={BUTTON_CLASS}
                >
                  <ThumbsUp className={ICON_CLASS} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Good response</Tooltip.Content>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type='button'
                  aria-label='Dislike'
                  onClick={() => handleFeedbackClick('down')}
                  className={BUTTON_CLASS}
                >
                  <ThumbsDown className={ICON_CLASS} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content side='top'>Bad response</Tooltip.Content>
            </Tooltip.Root>
          </>
        )}
        {canFork && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                aria-label='Fork in new chat'
                onClick={handleFork}
                disabled={forkChat.isPending}
                className={cn(BUTTON_CLASS, forkChat.isPending && 'cursor-not-allowed opacity-50')}
              >
                <Split className={cn(ICON_CLASS, 'rotate-90')} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Fork in new chat</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>

      <ChipModal
        open={pendingFeedback !== null}
        onOpenChange={handleModalClose}
        srTitle='Give feedback'
      >
        <ChipModalHeader onClose={() => handleModalClose(false)}>Give feedback</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='textarea'
            title='Feedback'
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
          secondaryActions={
            pendingFeedback === 'down' && requestId
              ? [{ label: copiedRequestId ? 'Copied' : 'Copy ID', onClick: copyRequestId }]
              : undefined
          }
          primaryAction={{
            label: 'Submit',
            onClick: handleSubmitFeedback,
          }}
        />
      </ChipModal>
    </>
  )
})
