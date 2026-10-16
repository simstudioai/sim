'use client'

import { useRef, useState } from 'react'
import {
  ArrowRight,
  Button,
  Check,
  ChevronLeft,
  ChevronRight,
  checkboxIconVariants,
  checkboxVariants,
  cn,
  X,
} from '@sim/emcn'
import {
  INTERACTION_CARD_ROW_CLASSES,
  InteractionCard,
  InteractionCardActionRow,
  InteractionCardInputRow,
  InteractionCardRecap,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import { ResourceQuestionRows } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question/resource-question-rows'
import type {
  InteractionAnswerHandler,
  QuestionItem,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { mapResourceToContext } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import type { ChatContext } from '@/stores/panel'

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

/** Ghost icon-button chrome shared by the stepper chevrons and the dismiss X. */
const ICON_BUTTON_CLASSES = 'relative size-[14px] shrink-0 p-0'

/**
 * Leading checkbox slot for multi_select rows. Purely presentational — it
 * reuses the emcn Checkbox chrome via its exported variants, but the row
 * button (or the free-text input) owns the interaction, so nesting a real
 * Radix checkbox button inside the row button is avoided.
 */
function RowCheckbox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <div className='flex size-[16px] shrink-0 items-center justify-center'>
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
  /**
   * Reports the combined answer, with any resources picked by
   * `resource_select` steps attached as contexts; undefined renders the card inert.
   */
  onSelect?: InteractionAnswerHandler
  /** Reports that the active card was dismissed so its message actions can return. */
  onDismiss?: () => void
  /** Whether the active card can be dismissed without answering. */
  dismissible?: boolean
}

/**
 * Inline renderer for the `<question>` special tag: a chat-inline div with the
 * user input's chrome, the current question's prompt at the top left, dismiss
 * (and a `‹ N of M ›` stepper for multi-step batches) at the top right, and
 * suggested-action option rows beneath, always followed by a custom-answer
 * text field whose placeholder reads "Something else". `single_select`
 * answers and advances on click (or on submitting typed text);
 * `resource_select` does the same over the workspace's live resources of one
 * family, with the text field filtering them; `multi_select`
 * rows toggle checkboxes and an option-styled Submit row confirms the step.
 * Answering the last question sends one combined user message and collapses
 * the div to a question/answer recap.
 */
export function QuestionDisplay({
  data,
  answers: transcriptAnswers,
  onSelect,
  onDismiss,
  dismissible = true,
}: QuestionDisplayProps) {
  const freeTextInputRef = useRef<HTMLInputElement>(null)
  const freeTextCheckboxRef = useRef<HTMLButtonElement>(null)
  const disabled = !onSelect
  const [phase, setPhase] = useState<QuestionPhase>('active')
  const [step, setStep] = useState(0)
  const [selectedByStep, setSelectedByStep] = useState<string[][]>(() => data.map(() => []))
  const [customByStep, setCustomByStep] = useState<string[]>(() => data.map(() => ''))
  // resource_select only: the resource behind a step's picked row, sent as a
  // chat context so the agent gets its id, not just the displayed name.
  // Only read on submit, so it never needs to re-render the card.
  const resourceByStep = useRef<(MothershipResource | null)[]>(data.map(() => null))
  const [freeText, setFreeText] = useState('')
  // multi_select only: whether the typed "Something else" text is included in
  // the answer. Unchecking keeps the text; it just stops counting.
  const [customCheckedByStep, setCustomCheckedByStep] = useState<boolean[]>(() =>
    data.map(() => false)
  )

  // The typed text that actually joins a step's answer: multi_select customs
  // only count while checked; single_select customs always count.
  const customFor = (i: number, customs: string[]): string =>
    data[i].type === 'multi_select' && !(customCheckedByStep[i] ?? false) ? '' : (customs[i] ?? '')

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
      <InteractionCardRecap
        items={data.map((question, index) => ({
          label: question.prompt,
          values: answerPartsForDisplay(question, recapAnswers[index] ?? ''),
        }))}
      />
    )
  }

  if (data.length === 0 || phase === 'dismissed') return null

  const question = data[step]
  const isLast = step === data.length - 1
  const isResource = question.type === 'resource_select'
  const options = isResource ? [] : question.options
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
  }

  const finishStep = (selections: string[][], customs: string[]) => {
    if (!isLast) {
      setStep(step + 1)
      const prefill = customs[step + 1] ?? ''
      setFreeText(prefill)
      return
    }
    setPhase('answered')
    const contexts = resourceByStep.current
      .map((resource) => (resource ? mapResourceToContext(resource) : null))
      .filter((context): context is ChatContext => context !== null)
    onSelect?.(
      formatQuestionAnswerMessage(
        data,
        data.map((q, i) => answerFor(q, selections[i] ?? [], customFor(i, customs)))
      ),
      contexts.length > 0 ? contexts : undefined
    )
  }

  const handleSingleSelect = (label: string, resource: MothershipResource | null = null) => {
    const selections = [...selectedByStep]
    selections[step] = [label]
    setSelectedByStep(selections)
    const customs = [...customByStep]
    customs[step] = ''
    setCustomByStep(customs)
    resourceByStep.current[step] = resource
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

  /**
   * multi_select only: confirms the current page's checked rows, then advances
   * or submits the whole batch. single_select needs no confirm step — a row
   * click or the free-text arrow is itself the answer.
   */
  const submitMultiStep = () => {
    finishStep(selectedByStep, commitCustom())
  }

  /** Sets whether the typed "Something else" text counts — never touches the text. */
  const setCustomChecked = (checked: boolean) => {
    const next = [...customCheckedByStep]
    next[step] = checked
    setCustomCheckedByStep(next)
  }

  const toggleCustomChecked = () => {
    const isChecked = customCheckedByStep[step] ?? false
    setCustomChecked(!isChecked)
    if (!isChecked) freeTextInputRef.current?.focus()
  }

  /** single_select free-text arrow: the typed text IS the answer. */
  const submitSingleFreeText = () => {
    const customs = commitCustom()
    const selections = [...selectedByStep]
    selections[step] = []
    setSelectedByStep(selections)
    resourceByStep.current[step] = null
    finishStep(selections, customs)
  }

  const stepAnswered = (i: number): boolean => {
    if ((selectedByStep[i]?.length ?? 0) > 0) return true
    const text = i === step ? freeText : (customByStep[i] ?? '')
    if (text.trim().length === 0) return false
    return data[i].type === 'multi_select' ? (customCheckedByStep[i] ?? false) : true
  }

  const canSubmitStep = !disabled && stepAnswered(step)
  // The single_select arrow submits the typed text specifically, so it tracks
  // the text rather than the step: a row selected on an earlier visit must not
  // arm an arrow that would replace it with an empty answer.
  const canSubmitFreeText = !disabled && freeText.trim().length > 0

  return (
    <InteractionCard
      title={question.prompt}
      actions={
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
                <ChevronLeft className='size-[14px] text-[var(--text-icon)]' />
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
                <ChevronRight className='size-[14px] text-[var(--text-icon)]' />
                <span className='sr-only'>Next question</span>
              </Button>
            </div>
          )}
          {!disabled && dismissible && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                setPhase('dismissed')
                onDismiss?.()
              }}
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
      }
    >
      <div className='flex flex-col'>
        {question.type === 'resource_select' && (
          <ResourceQuestionRows
            resourceType={question.resourceType}
            query={freeText}
            disabled={disabled}
            onPick={(resource) => handleSingleSelect(resource.title, resource)}
          />
        )}
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
                INTERACTION_CARD_ROW_CLASSES,
                disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                i > 0 && 'border-t',
                isSelected && 'bg-[var(--surface-5)]'
              )}
            >
              {isMulti ? <RowCheckbox checked={isSelected} disabled={disabled} /> : null}
              <span className='min-w-0 flex-1 whitespace-normal break-words text-[var(--text-body)] text-sm'>
                {option.label}
              </span>
              {!isMulti && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
            </button>
          )
        })}
        <InteractionCardInputRow
          ref={freeTextInputRef}
          divided={options.length > 0 || isResource}
          leading={
            isMulti ? (
              <div className='flex size-[16px] shrink-0 items-center justify-center'>
                <button
                  ref={freeTextCheckboxRef}
                  type='button'
                  aria-label='Include "Something else" in the answer'
                  disabled={disabled}
                  onClick={toggleCustomChecked}
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
            ) : undefined
          }
          trailing={
            !isMulti ? (
              <button
                type='button'
                aria-label='Submit answer'
                disabled={!canSubmitFreeText}
                onClick={submitSingleFreeText}
                className='disabled:cursor-default'
              >
                <ArrowRight
                  className={cn(
                    'size-[16px] shrink-0 transition-colors',
                    canSubmitFreeText ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
                  )}
                />
              </button>
            ) : undefined
          }
          type='text'
          value={freeText}
          placeholder={isResource ? 'Search or type something else' : 'Something else'}
          disabled={disabled}
          onFocus={() => {
            if (isMulti) setCustomChecked(true)
          }}
          onChange={(event) => setFreeText(event.target.value)}
          onBlur={(event) => {
            if (
              isMulti &&
              event.relatedTarget !== freeTextCheckboxRef.current &&
              freeText.trim().length === 0
            ) {
              setCustomChecked(false)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.blur()
              return
            }
            if (event.key !== 'Enter') return
            if (isMulti) {
              if (!canSubmitStep) return
              event.preventDefault()
              submitMultiStep()
              return
            }
            if (!canSubmitFreeText) return
            event.preventDefault()
            submitSingleFreeText()
          }}
          aria-label={question.prompt}
        />
        {isMulti && (
          <InteractionCardActionRow
            label={isLast ? 'Submit' : 'Continue'}
            disabled={!canSubmitStep}
            onClick={submitMultiStep}
            leading={<div className='flex size-[16px] shrink-0 items-center justify-center' />}
          />
        )}
      </div>
    </InteractionCard>
  )
}

/**
 * A step's combined answer: selected option labels in option order, with the
 * typed "Something else" entry appended last. single_select carries at most
 * one selection, so this collapses to the chosen label or the typed text; a
 * resource_select pick is not one of the question's options, so it is the
 * picked resource's name or the typed text.
 */
function answerFor(question: QuestionItem, selected: string[], custom: string): string {
  if (question.type === 'resource_select') return selected[0] ?? custom.trim()
  const ordered = question.options
    .map((option) => option.label)
    .filter((label) => selected.includes(label))
  const parts = custom.trim() ? [...ordered, custom.trim()] : ordered
  return parts.join(', ')
}

/** Separates known multi-select labels for the recap without changing the wire answer. */
function answerPartsForDisplay(question: QuestionItem, answer: string): string[] {
  if (question.type !== 'multi_select') return [answer]

  const parts: string[] = []
  let remaining = answer

  for (const option of question.options) {
    if (remaining === option.label) {
      parts.push(option.label)
      remaining = ''
      break
    }

    const optionPrefix = `${option.label}, `
    if (remaining.startsWith(optionPrefix)) {
      parts.push(option.label)
      remaining = remaining.slice(optionPrefix.length)
    }
  }

  if (remaining) parts.push(remaining)
  return parts.length > 0 ? parts : [answer]
}
