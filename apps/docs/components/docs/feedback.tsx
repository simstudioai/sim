'use client'

import { useRef, useState } from 'react'
import { ThumbsDown, ThumbsUp } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { DocsButton } from '@/components/docs/primitives'

interface FeedbackProps {
  page: string
}

export function Feedback({ page }: FeedbackProps) {
  const [client] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={client}>
      <FeedbackForm key={page} page={page} />
    </QueryClientProvider>
  )
}

function FeedbackForm({ page }: FeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const pendingSubmission = useRef<{
    submissionId: string
    helpful: boolean
    comment: string
  } | null>(null)
  const submission = useMutation({
    retry: false,
    mutationFn: async (payload: { submissionId: string; helpful: boolean; comment: string }) => {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, page }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'Too many submissions. Please try again in a minute.'
            : 'Could not send feedback. Please try again.'
        )
      const result: unknown = await response.json()
      if (
        !result ||
        typeof result !== 'object' ||
        !('accepted' in result) ||
        result.accepted !== true
      ) {
        throw new Error('Could not confirm feedback. Please try again.')
      }
    },
  })
  function submit(vote: boolean) {
    if (submission.isPending) return
    const text = vote ? '' : comment.trim()
    if (
      !pendingSubmission.current ||
      pendingSubmission.current.helpful !== vote ||
      pendingSubmission.current.comment !== text
    ) {
      pendingSubmission.current = { submissionId: generateId(), helpful: vote, comment: text }
    }
    submission.mutate(pendingSubmission.current)
  }
  if (submission.isSuccess) return <p role='status'>Thanks for your feedback.</p>
  return (
    <form
      className='min-w-0 space-y-3'
      onSubmit={(event) => {
        event.preventDefault()
        if (helpful !== null && !submission.isPending) submit(helpful)
      }}
    >
      <div className='flex items-center gap-2'>
        <span>Was this helpful?</span>
        <DocsButton
          type='button'
          aria-label='Yes, this was helpful'
          aria-pressed={helpful === true}
          disabled={submission.isPending}
          iconOnly
          className='size-11 aria-pressed:bg-[var(--docs-selected)]'
          onClick={() => {
            setHelpful(true)
            submission.reset()
            submit(true)
          }}
        >
          <ThumbsUp className='size-4' />
        </DocsButton>
        <DocsButton
          type='button'
          aria-label='No, this could be improved'
          aria-pressed={helpful === false}
          disabled={submission.isPending}
          iconOnly
          className='size-11 aria-pressed:bg-[var(--docs-selected)]'
          onClick={() => {
            setHelpful(false)
            submission.reset()
          }}
        >
          <ThumbsDown className='size-4' />
        </DocsButton>
      </div>
      {helpful === false && (
        <div className='space-y-2'>
          <label className='block' htmlFor='docs-feedback-comment'>
            What could be better? (optional)
          </label>
          <textarea
            id='docs-feedback-comment'
            aria-describedby='docs-feedback-privacy'
            value={comment}
            maxLength={2000}
            rows={3}
            disabled={submission.isPending}
            onChange={(event) => setComment(event.target.value)}
            className='w-full min-w-0 resize-y rounded-lg border border-[var(--docs-border)] bg-[var(--docs-canvas)] p-3 text-[var(--docs-heading)] text-docs-body focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2'
            placeholder='Tell us what was missing or unclear.'
          />
          <p id='docs-feedback-privacy'>Please don’t include private information.</p>
          <DocsButton
            type='submit'
            disabled={submission.isPending}
            className='h-11 border border-[var(--docs-border)]'
          >
            {submission.isPending ? 'Sending…' : 'Send feedback'}
          </DocsButton>
        </div>
      )}
      {submission.isPending && helpful === true && <p role='status'>Sending…</p>}
      {submission.isError && <p role='alert'>{submission.error.message}</p>}
    </form>
  )
}
