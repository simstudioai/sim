'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/_components/chat/cards/cards.module.css'
import type { PlatformQuestion } from '@/platform/app/(shell)/_components/chat/model'
import { Button, Checkbox, Chip, IconButton } from '@/platform/design-system/components'
import { Input } from '@/platform/design-system/components/field/inputs'

/** One `Prompt — Answer` line per question, the shape the transcript pairs back to this card. */
function formatAnswers(questions: readonly PlatformQuestion[], answers: readonly string[]): string {
  return questions.map((q, i) => `${q.prompt} — ${answers[i] ?? ''}`).join('\n')
}

function Recap({
  questions,
  answers,
}: {
  questions: readonly PlatformQuestion[]
  answers: readonly string[]
}) {
  return (
    <dl className={styles.fields}>
      {questions.map((question, index) => (
        <div key={question.prompt}>
          <dt data-type='T052'>{question.prompt}</dt>
          <dd data-type='T048'>{answers[index] || 'Skipped'}</dd>
        </div>
      ))}
    </dl>
  )
}

interface QuestionCardProps {
  questions: readonly PlatformQuestion[]
  /** From the transcript, which outlives this component on a reload. */
  answers?: readonly string[]
  onSubmit: (message: string) => void
}

export function QuestionCard({ questions, answers: stored, onSubmit }: QuestionCardProps) {
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<string[][]>(() => questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ''))
  const [answered, setAnswered] = useState<string[] | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const recap = stored ?? answered
  if (recap) return <Recap questions={questions} answers={recap} />
  const question = questions[step]
  if (!question || dismissed) return null
  const multi = question.type === 'multi_select'
  const isLast = step === questions.length - 1
  function answersFrom(picks: string[][], texts: string[]): string[] {
    return questions.map((item, index) =>
      [
        ...item.options
          .map((option) => option.label)
          .filter((label) => picks[index]?.includes(label)),
        ...(texts[index]?.trim() ? [texts[index].trim()] : []),
      ].join(', ')
    )
  }
  function finish(picks: string[][], texts: string[]) {
    if (!isLast) {
      setStep(step + 1)
      return
    }
    const answers = answersFrom(picks, texts)
    setAnswered(answers)
    onSubmit(formatAnswers(questions, answers))
  }
  function choose(label: string) {
    const picks = selected.map((item, index) => (index === step ? [label] : item))
    const texts = custom.map((item, index) => (index === step ? '' : item))
    setSelected(picks)
    setCustom(texts)
    finish(picks, texts)
  }
  function toggle(label: string) {
    setSelected(
      selected.map((item, index) =>
        index !== step
          ? item
          : item.includes(label)
            ? item.filter((value) => value !== label)
            : [...item, label]
      )
    )
  }
  const typed = custom[step] ?? ''
  return (
    <section className={styles.card} aria-label='Question'>
      <div className={styles.row}>
        <span className={styles.title} data-type='T048'>
          {question.prompt}
        </span>
        <span className={styles.actions}>
          {questions.length > 1 && (
            <>
              <IconButton
                label='Previous question'
                icon='I093'
                disabled={step === 0}
                onClick={() => setStep(step - 1)}
              />
              <span data-type='T052'>
                {step + 1} of {questions.length}
              </span>
              <IconButton
                label='Next question'
                icon='I090'
                disabled={isLast}
                onClick={() => setStep(step + 1)}
              />
            </>
          )}
          <IconButton label='Dismiss question' icon='I105' onClick={() => setDismissed(true)} />
        </span>
      </div>
      <div className={styles.options}>
        {question.options.map((option) =>
          multi ? (
            <Checkbox
              key={option.id}
              label={option.label}
              checked={selected[step]?.includes(option.label) ?? false}
              onCheckedChange={() => toggle(option.label)}
            />
          ) : (
            <Chip
              key={option.id}
              selected={selected[step]?.includes(option.label) ?? false}
              onClick={() => choose(option.label)}
            >
              {option.label}
            </Chip>
          )
        )}
      </div>
      <div className={styles.row}>
        <Input
          label='Something else'
          placeholder='Something else'
          value={typed}
          onChange={(next) =>
            setCustom(custom.map((item, index) => (index === step ? next : item)))
          }
        />
        {(multi || typed.trim()) && (
          <Button
            variant='primary'
            size='compact'
            disabled={multi && !typed.trim() && !selected[step]?.length}
            onClick={() => finish(selected, custom)}
          >
            {isLast ? 'Submit' : 'Next'}
          </Button>
        )}
      </div>
    </section>
  )
}
