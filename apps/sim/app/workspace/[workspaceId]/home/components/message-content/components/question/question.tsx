'use client'

import { useState } from 'react'
import { ArrowRight, Button, ChevronLeft, ChevronRight, cn, X } from '@sim/emcn'
import type { QuestionItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/**
 * Builds the single user message sent after the final question is answered.
 * A lone question sends just the answer text; a multi-step batch sends one
 * `Prompt — Answer` line per question.
 */
export function formatQuestionAnswerMessage(questions: QuestionItem[], answers: string[]): string {
  if (questions.length === 1) return answers[0]
  return questions.map((q, i) => `${q.prompt} — ${answers[i]}`).join('\n')
}

/**
 * The free-text input's initial value when (re)visiting a question: restore a
 * previously typed answer, but not one that matches an option row (that row is
 * highlighted instead).
 */
function freeTextPrefillFor(question: QuestionItem, answer: string | null): string {
  if (!answer) return ''
  if (question.type === 'text') return answer
  return question.options?.some((o) => o.label === answer) ? '' : answer
}

const OPTION_ROW_CLASSES =
  'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors'

/** Ghost icon-button chrome shared by the stepper chevrons and the dismiss X. */
const ICON_BUTTON_CLASSES = 'relative size-[14px] flex-shrink-0 p-0'

/** Leading number slot matching the suggested follow-ups rows. */
function RowNumber({ value }: { value: number }) {
  return (
    <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
      <span className='text-[var(--text-icon)] text-sm'>{value}</span>
    </div>
  )
}

type QuestionPhase = 'active' | 'answered' | 'dismissed'

interface QuestionDisplayProps {
  data: QuestionItem[]
  /** Sends the combined answer as a user message; undefined renders the div inert. */
  onSelect?: (message: string) => void
}

/**
 * Inline renderer for the `<question>` special tag: a chat-inline div with the
 * user input's chrome, the current question's prompt at the top left, dismiss
 * (and a `‹ N of M ›` stepper for multi-step batches) at the top right, and
 * suggested-action option rows beneath. `single_select` always appends a
 * free-text "Something else" row; `text` renders only the free-text row.
 * Answers collect locally; answering the last question sends one combined
 * user message and collapses the div to a question/answer recap.
 */
export function QuestionDisplay({ data, onSelect }: QuestionDisplayProps) {
  const disabled = !onSelect
  const [phase, setPhase] = useState<QuestionPhase>('active')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<(string | null)[]>(() => data.map(() => null))
  const [freeText, setFreeText] = useState('')

  if (data.length === 0 || phase === 'dismissed') return null

  const containerClasses =
    'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]'

  if (phase === 'answered') {
    return (
      <div className={containerClasses}>
        {data.map((question, i) => (
          <div key={i} className='px-2 py-2'>
            <p className='text-[var(--text-primary)] text-sm'>{question.prompt}</p>
            <p className='mt-1.5 text-[var(--text-muted)] text-sm'>{answers[i]}</p>
          </div>
        ))}
      </div>
    )
  }

  const question = data[step]
  const isLast = step === data.length - 1
  const options = question.type === 'text' ? [] : (question.options ?? [])
  const hasFreeText = question.type !== 'confirm'

  const goToStep = (next: number) => {
    setStep(next)
    setFreeText(freeTextPrefillFor(data[next], answers[next]))
  }

  const handleAnswer = (answer: string) => {
    const next = [...answers]
    next[step] = answer
    setAnswers(next)
    if (!isLast) {
      goToStep(step + 1)
      return
    }
    setPhase('answered')
    onSelect?.(
      formatQuestionAnswerMessage(
        data,
        next.map((a) => a ?? '')
      )
    )
  }

  const canSubmitFreeText = !disabled && freeText.trim().length > 0

  return (
    <div className={containerClasses}>
      <div className='flex items-center justify-between gap-2 px-2 py-2'>
        <p className='min-w-0 flex-1 break-words text-[var(--text-primary)] text-sm'>
          {question.prompt}
        </p>
        <div className='flex items-center gap-3'>
          {data.length > 1 && (
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='ghost'
                onClick={() => goToStep(step - 1)}
                disabled={step === 0}
                className={cn(
                  ICON_BUTTON_CLASSES,
                  'before:absolute before:inset-[-8px] before:content-[""] disabled:opacity-50'
                )}
              >
                <ChevronLeft className='h-[9px] w-[7px] text-[var(--text-icon)]' />
                <span className='sr-only'>Previous question</span>
              </Button>
              <span className='whitespace-nowrap text-[var(--text-muted)] text-sm tabular-nums'>
                {step + 1} of {data.length}
              </span>
              <Button
                type='button'
                variant='ghost'
                onClick={() => goToStep(step + 1)}
                disabled={isLast || answers[step] === null}
                className={cn(
                  ICON_BUTTON_CLASSES,
                  'before:absolute before:inset-[-8px] before:content-[""] disabled:opacity-50'
                )}
              >
                <ChevronRight className='h-[9px] w-[7px] text-[var(--text-icon)]' />
                <span className='sr-only'>Next question</span>
              </Button>
            </div>
          )}
          {!disabled && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => setPhase('dismissed')}
              className={cn(
                ICON_BUTTON_CLASSES,
                'before:absolute before:inset-[-14px] before:content-[""]'
              )}
            >
              <X className='size-[14px] text-[var(--text-icon)]' />
              <span className='sr-only'>Dismiss</span>
            </Button>
          )}
        </div>
      </div>
      <div className='flex flex-col'>
        {options.map((option, i) => (
          <button
            key={option.id}
            type='button'
            disabled={disabled}
            onClick={() => handleAnswer(option.label)}
            className={cn(
              OPTION_ROW_CLASSES,
              disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
              i > 0 && 'border-t',
              answers[step] === option.label && 'bg-[var(--surface-5)]'
            )}
          >
            <RowNumber value={i + 1} />
            <span className='flex-1 truncate text-[var(--text-body)] text-sm'>{option.label}</span>
            <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
          </button>
        ))}
        {hasFreeText && (
          <div className={cn(OPTION_ROW_CLASSES, options.length > 0 && 'border-t')}>
            <RowNumber value={options.length + 1} />
            <input
              type='text'
              value={freeText}
              disabled={disabled}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmitFreeText) {
                  e.preventDefault()
                  handleAnswer(freeText.trim())
                }
              }}
              placeholder={question.type === 'text' ? 'Type an answer' : 'Something else'}
              aria-label={question.prompt}
              className='min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed'
            />
            <button
              type='button'
              aria-label='Submit answer'
              disabled={!canSubmitFreeText}
              onClick={() => handleAnswer(freeText.trim())}
              className='disabled:cursor-default'
            >
              <ArrowRight
                className={cn(
                  'size-[16px] shrink-0 transition-colors',
                  canSubmitFreeText ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
                )}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
