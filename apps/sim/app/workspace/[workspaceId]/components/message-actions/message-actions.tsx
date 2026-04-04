'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Check,
  Copy,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  ThumbsDown,
  ThumbsUp,
} from '@/components/emcn'
import { useSubmitCopilotFeedback } from '@/hooks/queries/copilot-feedback'

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

const ICON_CLASS = 'h-[14px] w-[14px]'
const BUTTON_CLASS =
  'flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-none'

interface MessageActionsProps {
  content: string
  chatId?: string
  userQuery?: string
}

export function MessageActions({ content, chatId, userQuery }: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [pendingFeedback, setPendingFeedback] = useState<'up' | 'down' | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const resetTimeoutRef = useRef<number | null>(null)
  const submitFeedback = useSubmitCopilotFeedback()

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  const copyToClipboard = useCallback(async () => {
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
  }, [content])

  const handleFeedbackClick = useCallback(
    (type: 'up' | 'down') => {
      if (chatId && userQuery) {
        setPendingFeedback(type)
        setFeedbackText('')
      }
    },
    [chatId, userQuery]
  )

  const handleSubmitFeedback = useCallback(() => {
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
  }, [pendingFeedback, chatId, userQuery, content, feedbackText])

  const handleModalClose = useCallback((open: boolean) => {
    if (!open) {
      setPendingFeedback(null)
      setFeedbackText('')
    }
  }, [])

  if (!content) return null

  return (
    <>
      <div className='flex items-center gap-0.5'>
        <button
          type='button'
          aria-label='Copy message'
          onClick={copyToClipboard}
          className={BUTTON_CLASS}
        >
          {copied ? <Check className={ICON_CLASS} /> : <Copy className={ICON_CLASS} />}
        </button>
        <button
          type='button'
          aria-label='Like'
          onClick={() => handleFeedbackClick('up')}
          className={BUTTON_CLASS}
        >
          <ThumbsUp className={ICON_CLASS} />
        </button>
        <button
          type='button'
          aria-label='Dislike'
          onClick={() => handleFeedbackClick('down')}
          className={BUTTON_CLASS}
        >
          <ThumbsDown className={ICON_CLASS} />
        </button>
      </div>

      <Modal open={pendingFeedback !== null} onOpenChange={handleModalClose}>
        <ModalContent size='sm'>
          <ModalHeader>Give feedback</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>
                {pendingFeedback === 'up' ? 'What did you like?' : 'What could be improved?'}
              </p>
              <Textarea
                placeholder={
                  pendingFeedback === 'up'
                    ? 'Tell us what was helpful...'
                    : 'Tell us what went wrong...'
                }
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={3}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => handleModalClose(false)}>
              Cancel
            </Button>
            <Button variant='primary' onClick={handleSubmitFeedback}>
              Submit
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
