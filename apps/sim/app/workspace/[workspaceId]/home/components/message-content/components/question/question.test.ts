/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  formatQuestionAnswerMessage,
  parseQuestionAnswerMessage,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/question/question'
import type { QuestionItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

const QUESTIONS: QuestionItem[] = [
  {
    type: 'single_select',
    prompt: 'How should I handle the duplicates?',
    options: [{ id: 'keep_newest', label: 'Keep the newest entry' }],
  },
  {
    type: 'single_select',
    prompt: 'Delete 4 archived workflows?',
    options: [
      { id: 'yes', label: 'Delete them' },
      { id: 'no', label: 'Cancel' },
    ],
  },
  {
    type: 'single_select',
    prompt: 'What time zone should the daily report run in?',
    options: [
      { id: 'est', label: 'EST' },
      { id: 'pst', label: 'PST' },
    ],
  },
]

describe('formatQuestionAnswerMessage', () => {
  it('sends a prompt-answer line for a single question', () => {
    expect(formatQuestionAnswerMessage([QUESTIONS[0]], ['Keep the newest entry'])).toBe(
      'How should I handle the duplicates? — Keep the newest entry'
    )
  })

  it('sends one prompt-answer line per question for multi-step batches', () => {
    expect(formatQuestionAnswerMessage(QUESTIONS, ['Keep the newest entry', 'Cancel', 'EST'])).toBe(
      'How should I handle the duplicates? — Keep the newest entry\n' +
        'Delete 4 archived workflows? — Cancel\n' +
        'What time zone should the daily report run in? — EST'
    )
  })
})

describe('parseQuestionAnswerMessage', () => {
  it('round-trips what formatQuestionAnswerMessage produces', () => {
    const answers = ['Keep the newest entry', 'Cancel', 'EST']
    const message = formatQuestionAnswerMessage(QUESTIONS, answers)
    expect(parseQuestionAnswerMessage(QUESTIONS, message)).toEqual(answers)
  })

  it('round-trips a single question', () => {
    const message = formatQuestionAnswerMessage([QUESTIONS[0]], ['Merge them'])
    expect(parseQuestionAnswerMessage([QUESTIONS[0]], message)).toEqual(['Merge them'])
  })

  it('rejects an unrelated user message (dismissed card, typed something else)', () => {
    expect(parseQuestionAnswerMessage([QUESTIONS[0]], 'actually, show me the logs')).toBeNull()
  })

  it('rejects when the line count does not match the question count', () => {
    const partial = formatQuestionAnswerMessage(QUESTIONS.slice(0, 2), ['A', 'B'])
    expect(parseQuestionAnswerMessage(QUESTIONS, partial)).toBeNull()
  })

  it('rejects when a line pairs with the wrong prompt', () => {
    const swapped =
      'Delete 4 archived workflows? — Cancel\n' +
      'How should I handle the duplicates? — Keep the newest entry\n' +
      'What time zone should the daily report run in? — EST'
    expect(parseQuestionAnswerMessage(QUESTIONS, swapped)).toBeNull()
  })

  it('preserves em-dashes inside the answer text', () => {
    const message = formatQuestionAnswerMessage([QUESTIONS[0]], ['newest — but keep backups'])
    expect(parseQuestionAnswerMessage([QUESTIONS[0]], message)).toEqual([
      'newest — but keep backups',
    ])
  })
})
