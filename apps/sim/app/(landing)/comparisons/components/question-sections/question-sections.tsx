import { Fragment } from 'react'
import type { ComparisonQuestion } from '@/lib/compare/data'
import { ProseText } from '@/app/(landing)/comparisons/components/prose-text'

interface QuestionSectionsProps {
  questions: ComparisonQuestion[]
  /** Prefix for each section's id, unique on the page. */
  idPrefix: string
}

/**
 * One section per buyer question, its heading worded as the buyer asks it and its answer
 * directly beneath, each followed by a divider. Server-rendered, so answer engines can quote
 * every answer on its own.
 */
export function QuestionSections({ questions, idPrefix }: QuestionSectionsProps) {
  return questions.map(({ question, answer }, index) => {
    const sectionId = `${idPrefix}-${index}`
    const headingId = `${sectionId}-heading`
    return (
      <Fragment key={question}>
        <section id={sectionId} aria-labelledby={headingId} className='px-6 py-10'>
          <h2
            id={headingId}
            className='mb-4 text-[var(--text-primary)] text-xl leading-[100%] tracking-[-0.02em] lg:text-2xl'
          >
            {question}
          </h2>
          <p className='max-w-[720px] text-[var(--text-body)] text-small leading-[150%]'>
            <ProseText prose={answer} />
          </p>
        </section>
        <div className='h-px w-full bg-[var(--border)]' />
      </Fragment>
    )
  })
}
