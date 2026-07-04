'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Button,
  Check,
  checkboxIconVariants,
  checkboxVariants,
  ChevronLeft,
  ChevronRight,
  cn,
  X,
} from '@sim/emcn'
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

/**
 * Leading checkbox slot for multi_select rows. Purely presentational — it
 * reuses the emcn Checkbox chrome via its exported variants, but the row
 * button (or the free-text input) owns the interaction, so nesting a real
 * Radix checkbox button inside the row button is avoided.
 */
function RowCheckbox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
      <span
        data-state={checked ? 'checked' : 'unchecked'}
        data-disabled={disabled ? '' : undefined}
        className={checkboxVariants({ size: 'sm' })}
      >
        {checked && (
          <Check className={cn(checkboxIconVariants({ size: 'sm' }), 'text-[var(--surface-2)]')} />
        )}
      </span>
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
 * suggested-action option rows beneath, always followed by a "Something else"
 * row that reads as a plain option until clicked and then becomes the focused
 * text box. `single_select` answers and advances on click (or on submitting
 * typed text); `multi_select` rows toggle checkboxes and an option-styled
 * Submit row confirms the step. Answering the last question sends one
 * combined user message and collapses the div to a question/answer recap.
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
  // The "Something else" row reads as a plain option until clicked, then
  // becomes the focused text box (and reverts when left empty).
  const [freeTextEditing, setFreeTextEditing] = useState(false)
  // multi_select only: whether the typed "Something else" text is included in
  // the answer. Unchecking keeps the text; it just stops counting.
  const [customCheckedByStep, setCustomCheckedByStep] = useState<boolean[]>(() =>
    data.map(() => false)
  )

  // The typed text that actually joins a step's answer: multi_select customs
  // only count while checked; single_select customs always count.
  const customFor = (i: number, customs: string[]): string =>
    data[i].type === 'multi_select' && !(customCheckedByStep[i] ?? false) ? '' : (customs[i] ?? '')

  const containerClasses =
    'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]'

  // Transcript answers win over local state: they survive reloads (local
  // phase does not) and keep live + rehydrated renders identical.
  const localAnswers =
    phase === 'answered'
      ? data.map((question, i) =>
          answerFor(question, selectedByStep[i] ?? [], customFor(i, customByStep))
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
    const prefill = customByStep[next] ?? ''
    setFreeText(prefill)
    setFreeTextEditing(prefill.trim().length > 0)
  }

  const finishStep = (selections: string[][], customs: string[]) => {
    if (!isLast) {
      setStep(step + 1)
      const prefill = customs[step + 1] ?? ''
      setFreeText(prefill)
      setFreeTextEditing(prefill.trim().length > 0)
      return
    }
    setPhase('answered')
    onSelect?.(
      formatQuestionAnswerMessage(
        data,
        data.map((q, i) => answerFor(q, selections[i] ?? [], customFor(i, customs)))
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

  /** multi_select confirm: commits selections and/or typed text, then advances. */
  const submitMultiStep = () => {
    finishStep(selectedByStep, commitCustom())
  }

  /** Sets whether the typed "Something else" text counts — never touches the text. */
  const setCustomChecked = (checked: boolean) => {
    const next = [...customCheckedByStep]
    next[step] = checked
    setCustomCheckedByStep(next)
  }

  /** single_select free-text arrow: the typed text IS the answer. */
  const submitSingleFreeText = () => {
    const customs = commitCustom()
    const selections = [...selectedByStep]
    selections[step] = []
    setSelectedByStep(selections)
    finishStep(selections, customs)
  }

  const stepAnswered = (i: number): boolean => {
    if ((selectedByStep[i]?.length ?? 0) > 0) return true
    const text = i === step ? freeText : (customByStep[i] ?? '')
    if (text.trim().length === 0) return false
    return data[i].type === 'multi_select' ? (customCheckedByStep[i] ?? false) : true
  }

  const canSubmitStep = !disabled && (isMulti ? stepAnswered(step) : freeText.trim().length > 0)

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
              {isMulti ? (
                <RowCheckbox checked={isSelected} disabled={disabled} />
              ) : (
                <RowNumber value={i + 1} />
              )}
              <span className='flex-1 truncate text-[var(--text-body)] text-sm'>
                {option.label}
              </span>
              {!isMulti && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
            </button>
          )
        })}
        {freeTextEditing ? (
          <div className={cn(OPTION_ROW_CLASSES, options.length > 0 && 'border-t')}>
            {isMulti ? (
              // Checked from the moment the row is clicked into; blur with
              // nothing typed reverts to the plain option row. A real button
              // (the editing row is a div, so no nesting hazard) so the box
              // can be toggled even after typing — unchecking keeps the text,
              // it just stops counting toward the answer.
              <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
                <button
                  type='button'
                  aria-label='Include "Something else" in the answer'
                  disabled={disabled}
                  onClick={() => setCustomChecked(!(customCheckedByStep[step] ?? false))}
                  data-state={(customCheckedByStep[step] ?? false) ? 'checked' : 'unchecked'}
                  data-disabled={disabled ? '' : undefined}
                  className={checkboxVariants({ size: 'sm' })}
                >
                  {(customCheckedByStep[step] ?? false) && (
                    <Check
                      className={cn(
                        checkboxIconVariants({ size: 'sm' }),
                        'text-[var(--surface-2)]'
                      )}
                    />
                  )}
                </button>
              </div>
            ) : (
              <RowNumber value={options.length + 1} />
            )}
            <input
              type='text'
              value={freeText}
              disabled={disabled}
              autoFocus
              onChange={(e) => setFreeText(e.target.value)}
              onBlur={() => {
                if (freeText.trim().length === 0) {
                  setFreeTextEditing(false)
                  if (isMulti) setCustomChecked(false)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.currentTarget.blur()
                  return
                }
                if (e.key === 'Enter' && canSubmitStep) {
                  e.preventDefault()
                  if (isMulti) {
                    submitMultiStep()
                  } else {
                    submitSingleFreeText()
                  }
                }
              }}
              aria-label={question.prompt}
              className='min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none disabled:cursor-not-allowed'
            />
            {!isMulti && (
              <button
                type='button'
                aria-label='Submit answer'
                disabled={!canSubmitStep}
                onClick={submitSingleFreeText}
                className='disabled:cursor-default'
              >
                <ArrowRight
                  className={cn(
                    'size-[16px] shrink-0 transition-colors',
                    canSubmitStep ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
                  )}
                />
              </button>
            )}
          </div>
        ) : (
          <button
            type='button'
            disabled={disabled}
            onClick={() => {
              setFreeTextEditing(true)
              if (isMulti) setCustomChecked(true)
            }}
            className={cn(
              OPTION_ROW_CLASSES,
              options.length > 0 && 'border-t',
              disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]'
            )}
          >
            {isMulti ? (
              <RowCheckbox checked={false} disabled={disabled} />
            ) : (
              <RowNumber value={options.length + 1} />
            )}
            <span className='flex-1 truncate text-[var(--text-body)] text-sm'>Something else</span>
            {!isMulti && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
          </button>
        )}
        {isMulti && (
          <button
            type='button'
            disabled={!canSubmitStep}
            onClick={submitMultiStep}
            className={cn(
              OPTION_ROW_CLASSES,
              'border-t',
              canSubmitStep ? 'hover-hover:bg-[var(--surface-5)]' : 'cursor-not-allowed'
            )}
          >
            <div className='flex size-[16px] flex-shrink-0 items-center justify-center' />
            <span
              className={cn(
                'flex-1 truncate text-sm',
                canSubmitStep ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
              )}
            >
              Submit
            </span>
            <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
          </button>
        )}
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
