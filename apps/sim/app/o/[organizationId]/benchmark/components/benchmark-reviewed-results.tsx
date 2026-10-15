'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { BenchmarkRun } from '@/lib/api/contracts/benchmarks'
import { BenchmarkResults } from '@/app/o/[organizationId]/benchmark/components/benchmark-results'
import { useReviewBenchmarkRun } from '@/hooks/queries/benchmarks'

interface BenchmarkReviewedResultsProps {
  run: BenchmarkRun
  organizationId: string
}

export function BenchmarkReviewedResults({ run, organizationId }: BenchmarkReviewedResultsProps) {
  const mutation = useReviewBenchmarkRun(organizationId, run.benchmarkId, run.id)
  const [draft, setDraft] = useState<{
    id: string
    correct: boolean
    note: string
    version: number
  } | null>(null)
  const close = () => {
    if (!mutation.isPending) setDraft(null)
  }

  return (
    <>
      {!draft && mutation.error && (
        <p role='alert' className='text-[var(--text-error)] text-small'>
          {mutation.error.message}
        </p>
      )}
      <BenchmarkResults
        artifacts={run.artifacts}
        showGrade
        reviews={run.reviews}
        reviewing={mutation.isPending}
        onReview={(id, correct) => {
          mutation.reset()
          if (correct === null) {
            mutation.mutate({ version: run.version, blankId: id, correct: null })
          } else {
            setDraft({
              id,
              correct,
              version: run.version,
              note: run.reviews.find((review) => review.id === id)?.note ?? '',
            })
          }
        }}
      />
      {draft && (
        <ChipModal
          open
          onOpenChange={(open) => !open && close()}
          size='sm'
          srTitle='Review benchmark detail'
        >
          <ChipModalHeader onClose={close}>
            Mark as {draft.correct ? 'correct' : 'incorrect'}
          </ChipModalHeader>
          <ChipModalBody>
            <ChipModalField
              type='textarea'
              title='Review note (optional)'
              value={draft.note}
              onChange={(note) => setDraft({ ...draft, note })}
              maxLength={2_000}
              rows={4}
              disabled={mutation.isPending}
              hint={`Your judgment for “${draft.id}” updates the score. The AI assessment is preserved.`}
            />
            <ChipModalError>{mutation.error?.message}</ChipModalError>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={close}
            primaryAction={{
              label: mutation.isPending ? 'Saving…' : 'Save review',
              disabled: mutation.isPending,
              onClick: () =>
                mutation.mutate(
                  {
                    version: draft.version,
                    blankId: draft.id,
                    correct: draft.correct,
                    note: draft.note,
                  },
                  { onSuccess: () => setDraft(null) }
                ),
            }}
          />
        </ChipModal>
      )}
    </>
  )
}
