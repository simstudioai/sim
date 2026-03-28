'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { markLessonComplete } from '@/lib/academy/local-progress'
import type { QuizDefinition, QuizQuestion } from '@/lib/academy/types'
import { cn } from '@/lib/core/utils/cn'

interface LessonQuizProps {
  lessonId: string
  quizConfig: QuizDefinition
  onPass?: () => void
}

type Answers = Record<number, number | number[] | boolean>

interface QuizResult {
  score: number
  passed: boolean
  feedback: Array<{ correct: boolean; explanation?: string }>
}

function scoreQuiz(questions: QuizQuestion[], answers: Answers, passingScore: number): QuizResult {
  const feedback = questions.map((q, i) => {
    const answer = answers[i]
    let correct = false
    if (q.type === 'multiple_choice') correct = answer === q.correctIndex
    else if (q.type === 'true_false') correct = answer === q.correctAnswer
    else if (q.type === 'multi_select') {
      const selected = (answer as number[] | undefined) ?? []
      correct =
        selected.length === q.correctIndices.length &&
        selected.every((v) => q.correctIndices.includes(v))
    } else {
      const _exhaustive: never = q
      void _exhaustive
    }
    return { correct, explanation: 'explanation' in q ? q.explanation : undefined }
  })
  const score = Math.round((feedback.filter((f) => f.correct).length / questions.length) * 100)
  return { score, passed: score >= passingScore, feedback }
}

const optionBase =
  'w-full text-left rounded-[6px] border px-4 py-3 text-[14px] transition-colors disabled:cursor-default'

/**
 * Interactive quiz component with per-question feedback and retry support.
 * Scoring is performed entirely client-side.
 */
export function LessonQuiz({ lessonId, quizConfig, onPass }: LessonQuizProps) {
  const [answers, setAnswers] = useState<Answers>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  // Reset quiz state when the lesson changes (component is reused across quiz-lesson navigations).
  const [prevLessonId, setPrevLessonId] = useState(lessonId)
  if (prevLessonId !== lessonId) {
    setPrevLessonId(lessonId)
    setAnswers({})
    setResult(null)
  }

  const handleAnswer = (qi: number, value: number | boolean) => {
    if (!result) setAnswers((prev) => ({ ...prev, [qi]: value }))
  }

  const handleMultiSelect = (qi: number, oi: number) => {
    if (result) return
    setAnswers((prev) => {
      const current = (prev[qi] as number[] | undefined) ?? []
      const next = current.includes(oi) ? current.filter((i) => i !== oi) : [...current, oi]
      return { ...prev, [qi]: next }
    })
  }

  const allAnswered = quizConfig.questions.every((q, i) => {
    if (q.type === 'multi_select')
      return Array.isArray(answers[i]) && (answers[i] as number[]).length > 0
    return answers[i] !== undefined
  })

  const handleSubmit = () => {
    const scored = scoreQuiz(quizConfig.questions, answers, quizConfig.passingScore)
    setResult(scored)
    if (scored.passed) {
      markLessonComplete(lessonId)
      onPass?.()
    }
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='font-[430] text-[#ECECEC] text-[20px]'>Quiz</h2>
        <p className='mt-1 text-[#666] text-[14px]'>
          Score {quizConfig.passingScore}% or higher to pass.
        </p>
      </div>

      {quizConfig.questions.map((q, qi) => {
        const feedback = result?.feedback[qi]
        const isCorrect = feedback?.correct

        return (
          <div key={qi} className='rounded-[8px] bg-[#222] p-5'>
            <p className='mb-4 font-[430] text-[#ECECEC] text-[15px]'>{q.question}</p>

            {q.type === 'multiple_choice' && (
              <div className='space-y-2'>
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    type='button'
                    onClick={() => handleAnswer(qi, oi)}
                    disabled={Boolean(result)}
                    className={cn(
                      optionBase,
                      answers[qi] === oi
                        ? 'border-[#ECECEC]/40 bg-[#ECECEC]/5 text-[#ECECEC]'
                        : 'border-[#2A2A2A] text-[#999] hover:border-[#3A3A3A] hover:bg-[#272727]',
                      result &&
                        oi === q.correctIndex &&
                        'border-[#4CAF50]/50 bg-[#4CAF50]/5 text-[#4CAF50]',
                      result &&
                        answers[qi] === oi &&
                        oi !== q.correctIndex &&
                        'border-[#f44336]/40 bg-[#f44336]/5 text-[#f44336]'
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'true_false' && (
              <div className='flex gap-3'>
                {(['True', 'False'] as const).map((label) => {
                  const val = label === 'True'
                  return (
                    <button
                      key={label}
                      type='button'
                      onClick={() => handleAnswer(qi, val)}
                      disabled={Boolean(result)}
                      className={cn(
                        'flex-1 rounded-[6px] border px-4 py-3 text-[14px] transition-colors disabled:cursor-default',
                        answers[qi] === val
                          ? 'border-[#ECECEC]/40 bg-[#ECECEC]/5 text-[#ECECEC]'
                          : 'border-[#2A2A2A] text-[#999] hover:border-[#3A3A3A] hover:bg-[#272727]',
                        result &&
                          val === q.correctAnswer &&
                          'border-[#4CAF50]/50 bg-[#4CAF50]/5 text-[#4CAF50]',
                        result &&
                          answers[qi] === val &&
                          val !== q.correctAnswer &&
                          'border-[#f44336]/40 bg-[#f44336]/5 text-[#f44336]'
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}

            {q.type === 'multi_select' && (
              <div className='space-y-2'>
                {q.options.map((opt, oi) => {
                  const selected = ((answers[qi] as number[]) ?? []).includes(oi)
                  return (
                    <button
                      key={oi}
                      type='button'
                      onClick={() => handleMultiSelect(qi, oi)}
                      disabled={Boolean(result)}
                      className={cn(
                        optionBase,
                        selected
                          ? 'border-[#ECECEC]/40 bg-[#ECECEC]/5 text-[#ECECEC]'
                          : 'border-[#2A2A2A] text-[#999] hover:border-[#3A3A3A] hover:bg-[#272727]',
                        result &&
                          q.correctIndices.includes(oi) &&
                          'border-[#4CAF50]/50 bg-[#4CAF50]/5 text-[#4CAF50]',
                        result &&
                          selected &&
                          !q.correctIndices.includes(oi) &&
                          'border-[#f44336]/40 bg-[#f44336]/5 text-[#f44336]'
                      )}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}

            {feedback && (
              <div
                className={cn(
                  'mt-3 flex items-start gap-2 rounded-[6px] px-3 py-2.5 text-[13px]',
                  isCorrect ? 'bg-[#4CAF50]/10 text-[#4CAF50]' : 'bg-[#f44336]/10 text-[#f44336]'
                )}
              >
                {isCorrect ? (
                  <CheckCircle2 className='mt-0.5 h-3.5 w-3.5 flex-shrink-0' />
                ) : (
                  <XCircle className='mt-0.5 h-3.5 w-3.5 flex-shrink-0' />
                )}
                <span>{isCorrect ? 'Correct!' : (feedback.explanation ?? 'Incorrect.')}</span>
              </div>
            )}
          </div>
        )
      })}

      {result && (
        <div
          className={cn(
            'rounded-[8px] border p-5',
            result.passed
              ? 'border-[#3A4A3A] bg-[#1F2A1F] text-[#4CAF50]'
              : 'border-[#3A2A2A] bg-[#2A1F1F] text-[#f44336]'
          )}
        >
          <p className='font-[430] text-[15px]'>{result.passed ? 'Passed!' : 'Keep trying!'}</p>
          <p className='mt-1 text-[13px] opacity-80'>
            Score: {result.score}% (passing: {quizConfig.passingScore}%)
          </p>
          {!result.passed && (
            <button
              type='button'
              onClick={() => {
                setAnswers({})
                setResult(null)
              }}
              className='mt-3 rounded-[5px] border border-[#3A2A2A] bg-[#2A1F1F] px-3 py-1.5 text-[#999] text-[13px] transition-colors hover:border-[#4A3A3A] hover:text-[#ECECEC]'
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!result && (
        <button
          type='button'
          onClick={handleSubmit}
          disabled={!allAnswered}
          className='rounded-[5px] bg-[#ECECEC] px-5 py-2.5 font-[430] text-[#1C1C1C] text-[14px] transition-colors hover:bg-white disabled:opacity-40'
        >
          Submit answers
        </button>
      )}
    </div>
  )
}
