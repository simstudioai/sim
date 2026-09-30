import { Chip, cn } from '@sim/emcn'
import type { BenchmarkCase, BenchmarkRun } from '@/lib/api/contracts/benchmarks'

interface BenchmarkResultsProps {
  artifacts: BenchmarkCase['artifacts']
  showGrade?: boolean
  reviews?: BenchmarkRun['reviews']
  reviewing?: boolean
  onReview?: (id: string, correct: boolean | null) => void
}

export function BenchmarkResults({
  artifacts,
  showGrade = false,
  reviews = [],
  reviewing,
  onReview,
}: BenchmarkResultsProps) {
  const { blanks, reconstruction, grade } = artifacts
  const answers = new Map(reconstruction?.map((answer) => [answer.id, answer]))
  const grades = new Map(grade?.map((result) => [result.id, result]))
  const overrides = new Map(reviews.map((review) => [review.id, review]))

  return (
    <div className='divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]'>
      {blanks.map((blank) => {
        const answer = answers.get(blank.id)
        const result = showGrade ? grades.get(blank.id) : undefined
        const review = overrides.get(blank.id)
        const correct = review?.correct ?? result?.correct
        return (
          <div key={blank.id} className='flex flex-col gap-3 p-4'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-mono text-[var(--text-body)] text-small'>{blank.id}</span>
              {result && (
                <span
                  className={cn(
                    'text-small',
                    correct ? 'text-[var(--badge-success-text)]' : 'text-[var(--text-error)]'
                  )}
                >
                  {correct ? 'Recovered' : 'Not recovered'}
                  {review ? ' · Human reviewed' : ''}
                </span>
              )}
              {!result && answer?.evidenceError && (
                <div>
                  <dt className='text-[var(--text-muted)]'>Evidence needs review</dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {answer.evidenceError}
                  </dd>
                </div>
              )}
            </div>
            <dl className='flex flex-col gap-3 text-small'>
              {showGrade && (
                <div>
                  <dt className='text-[var(--text-muted)]'>Expected</dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {blank.answer}
                  </dd>
                </div>
              )}
              <div>
                <dt className='text-[var(--text-muted)]'>Recovered answer</dt>
                <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                  {answer?.answer || 'No answer returned'}
                </dd>
              </div>
              <div>
                <dt className='text-[var(--text-muted)]'>
                  Supporting passage from the generated spec
                </dt>
                <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                  {answer?.support || 'No supporting passage'}
                </dd>
              </div>
              {answer?.sources?.map((source, index) => (
                <div key={`${source.citationId}-${index}`}>
                  <dt className='text-[var(--text-muted)]'>
                    Resolved reference ·{' '}
                    {source.url ? (
                      <a
                        href={source.url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline'
                      >
                        {source.title || source.citationId}
                      </a>
                    ) : (
                      source.title || source.citationId
                    )}
                  </dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {source.quote}
                  </dd>
                </div>
              ))}
              {result && (
                <div>
                  <dt className='text-[var(--text-muted)]'>
                    AI assessment
                    {result.basis === 'missing'
                      ? ' · Missing from plan'
                      : result.basis === 'reference'
                        ? ' · Reference resolved'
                        : ''}
                    {review ? ` · ${result.correct ? 'Recovered' : 'Not recovered'}` : ''}
                  </dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {result.reason}
                  </dd>
                </div>
              )}
              {review?.note && (
                <div>
                  <dt className='text-[var(--text-muted)]'>Human review note</dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {review.note}
                  </dd>
                </div>
              )}
            </dl>
            {result && onReview && (
              <div className='flex flex-wrap gap-1'>
                <Chip disabled={reviewing} onClick={() => onReview(blank.id, !correct)}>
                  {correct ? 'Mark as incorrect' : 'Mark as correct'}
                </Chip>
                {review && (
                  <>
                    <Chip disabled={reviewing} onClick={() => onReview(blank.id, review.correct)}>
                      Edit review
                    </Chip>
                    <Chip disabled={reviewing} onClick={() => onReview(blank.id, null)}>
                      Use AI grade
                    </Chip>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
