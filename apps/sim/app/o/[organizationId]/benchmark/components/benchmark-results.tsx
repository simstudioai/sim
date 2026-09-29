import { cn } from '@sim/emcn'
import type { BenchmarkCase } from '@/lib/api/contracts/benchmarks'

interface BenchmarkResultsProps {
  artifacts: BenchmarkCase['artifacts']
  showGrade?: boolean
}

export function BenchmarkResults({ artifacts, showGrade = false }: BenchmarkResultsProps) {
  const { blanks, reconstruction, grade } = artifacts
  const answers = new Map(reconstruction?.map((answer) => [answer.id, answer]))
  const grades = new Map(grade?.map((result) => [result.id, result]))

  return (
    <div className='divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]'>
      {blanks.map((blank) => {
        const answer = answers.get(blank.id)
        const result = showGrade ? grades.get(blank.id) : undefined
        return (
          <div key={blank.id} className='flex flex-col gap-3 p-4'>
            <div className='flex items-center justify-between gap-2'>
              <span className='font-mono text-[var(--text-body)] text-small'>{blank.id}</span>
              {result && (
                <span
                  className={cn(
                    'text-small',
                    result.correct ? 'text-[var(--badge-success-text)]' : 'text-[var(--text-error)]'
                  )}
                >
                  {result.correct ? 'Recovered' : 'Not recovered'}
                </span>
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
                  {answer?.answer || 'Not specified'}
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
              {result && (
                <div>
                  <dt className='text-[var(--text-muted)]'>Assessment</dt>
                  <dd className='mt-1 whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {result.reason}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )
      })}
    </div>
  )
}
