/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatQuestionAnswerMessage } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question/question'
import type { QuestionItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

const QUESTIONS: QuestionItem[] = [
  {
    type: 'single_select',
    prompt: 'How should I handle the duplicates?',
    options: [{ id: 'keep_newest', label: 'Keep the newest entry' }],
  },
  {
    type: 'confirm',
    prompt: 'Delete 4 archived workflows?',
    options: [
      { id: 'yes', label: 'Delete them' },
      { id: 'no', label: 'Cancel' },
    ],
  },
  { type: 'text', prompt: 'What time zone should the daily report run in?' },
]

describe('formatQuestionAnswerMessage', () => {
  it('sends just the answer for a single question', () => {
    expect(formatQuestionAnswerMessage([QUESTIONS[0]], ['Keep the newest entry'])).toBe(
      'Keep the newest entry'
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
