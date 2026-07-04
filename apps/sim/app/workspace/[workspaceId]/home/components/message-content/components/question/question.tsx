'use client'

import { useState } from 'react'
import { ArrowRight, Button, Check, ChevronLeft, ChevronRight, cn, X } from '@sim/emcn'
import type { QuestionItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/**
 * Builds the single user message sent after the final question is answered:
 * one `Prompt — Answer` line per question, for lone questions too. The uniform
 * shape is what lets the chat pair this message back to its question card
 * (see parseQuestionAnswerMessage) and render the card as the user turn
 * instead of echoing a duplicate bubble.
 */
export function formatQuestionAnswerMessage(questions: QuestionItem[], answers: string[]): string {
  return questions.map((q, i) => `${q.prompt} — ${answers[i] ?? ''}`).join('\n')
}

/**
 * Strictly matches a user message against a question batch's answer format:
 * exactly one `Prompt — Answer` line per question, in order. Returns the
 * answers, or null when the message is not this batch's answer — a dismissed
 * card followed by an unrelated typed message must not match.
 */
export function parseQuestionAnswerMessage(
  questions: QuestionItem[],
  content: string
): string[] | null {
  const lines = content.split('\n')
  if (lines.length !== questions.length) return null
  const answers: string[] = []
  for (const [i, question] of questions.entries()) {
    const prefix = `${question.prompt} — `
    if (!lines[i].startsWith(prefix)) return null
    answers.push(lines[i].slice(prefix.length))
  }
  return answers
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
  /**
   * Answers resolved from the transcript (the paired user message that
   * answered this card). When present the card renders as the answered recap
   * — it IS the user turn; the paired message bubble is hidden by the chat.
   */
  answers?: string[]
  /** Sends the combined answer as a user message; undefined renders the div inert. */
  onSelect?: (message: string) => void
}

/**
 * Inline renderer for the `<question>` special tag: a chat-inline div with the
 * user input's chrome, the current question's prompt at the top left, dismiss
 * (and a `‹ N of M ›` stepper for multi-step batches) at the top right, and
 * suggested-action option rows beneath. Both question types append a
 * free-text "Something else" row. `single_select` answers and advances on
 * click; `multi_select` rows toggle and the free-text row's arrow submits the
 * step. Answering the last question sends one combined user message and
 * collapses the div to a question/answer recap.
 */
export function QuestionDisplay({
  data,
  answers: transcriptAnswers,
  onSelect,
}: QuestionDisplayProps) {
  const disabled = !onSelect
  const [phase, setPhase] = useState<QuestionPhase>('active')
  const [step, setStep] = useState(0)
  const [selectedByStep, setSelectedByStep] = useState<string[][]>(() => data.map(() => []))
  const [customByStep, setCustomByStep] = useState<string[]>(() => data.map(() => ''))
  const [freeText, setFreeText] = useState('')

  const containerClasses =
    'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]'

  // Transcript answers win over local state: they survive reloads (local
  // phase does not) and keep live + rehydrated renders identical.
  const localAnswers =
    phase === 'answered'
      ? data.map((question, i) =>
          answerFor(question, selectedByStep[i] ?? [], customByStep[i] ?? '')
        )
      : null
  const recapAnswers = transcriptAnswers ?? localAnswers
  if (data.length > 0 && recapAnswers) {
    return (
      <div className={containerClasses}>
        {data.map((question, i) => (
          <div key={i} className='px-2 py-2'>
            <p className='text-[var(--text-primary)] text-sm'>{question.prompt}</p>
            <p className='mt-1.5 text-[var(--text-muted)] text-sm'>{recapAnswers[i]}</p>
          </div>
        ))}
      </div>
    )
  }

  if (data.length === 0 || phase === 'dismissed') return null

  const question = data[step]
  const isLast = step === data.length - 1
  const options = question.options
  const selected = selectedByStep[step] ?? []
  const isMulti = question.type === 'multi_select'

  const commitCustom = (): string[] => {
    const next = [...customByStep]
    next[step] = freeText.trim()
    setCustomByStep(next)
    return next
  }

  const goToStep = (next: number) => {
    commitCustom()
    setStep(next)
    setFreeText(customByStep[next] ?? '')
  }

  const finishStep = (selections: string[][], customs: string[]) => {
    if (!isLast) {
      setStep(step + 1)
      setFreeText(customs[step + 1] ?? '')
      return
    }
    setPhase('answered')
    onSelect?.(
      formatQuestionAnswerMessage(
        data,
        data.map((q, i) => answerFor(q, selections[i] ?? [], customs[i] ?? ''))
      )
    )
  }

  const handleSingleSelect = (label: string) => {
    const selections = [...selectedByStep]
    selections[step] = [label]
    setSelectedByStep(selections)
    const customs = [...customByStep]
    customs[step] = ''
    setCustomByStep(customs)
    setFreeText('')
    finishStep(selections, customs)
  }

  const handleMultiToggle = (label: string) => {
    const selections = [...selectedByStep]
    const current = selections[step] ?? []
    selections[step] = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label]
    setSelectedByStep(selections)
  }

  const submitFreeTextRow = () => {
    const customs = commitCustom()
    if (isMulti) {
      finishStep(selectedByStep, customs)
      return
    }
    const selections = [...selectedByStep]
    selections[step] = []
    setSelectedByStep(selections)
    finishStep(selections, customs)
  }

  const stepAnswered = (i: number): boolean =>
    (selectedByStep[i]?.length ?? 0) > 0 ||
    (i === step ? freeText.trim().length > 0 : (customByStep[i] ?? '').trim().length > 0)

  // single_select: the arrow submits the typed "Something else" answer.
  // multi_select: the arrow submits the step (selections and/or typed text).
  const canSubmitRow = !disabled && (isMulti ? stepAnswered(step) : freeText.trim().length > 0)

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
                // Inert renders (older messages) browse freely; interactive ones
                // gate forward movement on the current question being answered.
                disabled={isLast || (!disabled && !stepAnswered(step))}
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
        {options.map((option, i) => {
          const isSelected = selected.includes(option.label)
          return (
            <button
              key={option.id}
              type='button'
              disabled={disabled}
              onClick={() =>
                isMulti ? handleMultiToggle(option.label) : handleSingleSelect(option.label)
              }
              className={cn(
                OPTION_ROW_CLASSES,
                disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                i > 0 && 'border-t',
                isSelected && 'bg-[var(--surface-5)]'
              )}
            >
              <RowNumber value={i + 1} />
              <span className='flex-1 truncate text-[var(--text-body)] text-sm'>
                {option.label}
              </span>
              {isMulti && isSelected ? (
                <Check className='size-[16px] shrink-0 text-[var(--text-body)]' />
              ) : (
                <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
              )}
            </button>
          )
        })}
        <div className={cn(OPTION_ROW_CLASSES, options.length > 0 && 'border-t')}>
          <RowNumber value={options.length + 1} />
          <input
            type='text'
            value={freeText}
            disabled={disabled}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmitRow) {
                e.preventDefault()
                submitFreeTextRow()
              }
            }}
            placeholder='Something else'
            aria-label={question.prompt}
            className='min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed'
          />
          <button
            type='button'
            aria-label='Submit answer'
            disabled={!canSubmitRow}
            onClick={submitFreeTextRow}
            className='disabled:cursor-default'
          >
            <ArrowRight
              className={cn(
                'size-[16px] shrink-0 transition-colors',
                canSubmitRow ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
              )}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A step's combined answer: selected option labels in option order, with the
 * typed "Something else" entry appended last. single_select carries at most
 * one selection, so this collapses to the chosen label or the typed text.
 */
function answerFor(question: QuestionItem, selected: string[], custom: string): string {
  const ordered = question.options
    .map((option) => option.label)
    .filter((label) => selected.includes(label))
  const parts = custom.trim() ? [...ordered, custom.trim()] : ordered
  return parts.join(', ')
}
