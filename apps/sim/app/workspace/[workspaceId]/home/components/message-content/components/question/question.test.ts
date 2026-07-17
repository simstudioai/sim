/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  formatQuestionAnswerMessage,
  parseQuestionAnswerMessage,
  QuestionDisplay,
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
    type: 'multi_select',
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
    const answers = ['Keep the newest entry', 'Cancel', 'EST, PST']
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

describe('QuestionDisplay', () => {
  it('renders multi-select recap answers as separate, spaced rows', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(QuestionDisplay, {
          data: [QUESTIONS[2]],
          answers: ['EST, PST'],
        })
      )
    })

    const answerContainer = container.querySelector('.gap-1')
    expect(Array.from(answerContainer?.children ?? []).map((child) => child.textContent)).toEqual([
      'EST',
      'PST',
    ])

    act(() => root.unmount())
    container.remove()
  })

  it('renders Something else as a placeholder instead of an option', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(QuestionDisplay, {
          data: [QUESTIONS[0]],
          onSelect: () => undefined,
        })
      )
    })

    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    expect(input?.placeholder).toBe('Something else')
    expect(input?.className).toContain('placeholder:text-[var(--text-muted)]')
    expect(container.textContent).not.toContain('Something else')

    const optionButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Keep the newest entry'
    )
    expect(optionButton).toBeDefined()

    act(() => root.unmount())
    container.remove()
  })

  it('focuses the Something else input when its multi-select checkbox is selected', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(QuestionDisplay, {
          data: [QUESTIONS[2]],
          onSelect: () => undefined,
        })
      )
    })

    const input = container.querySelector('input')
    const checkbox = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Include \\"Something else\\" in the answer"]'
    )
    expect(input).not.toBeNull()
    expect(checkbox).not.toBeNull()

    act(() => checkbox?.click())

    expect(checkbox?.dataset.state).toBe('checked')
    expect(document.activeElement).toBe(input)

    act(() => checkbox?.focus())
    act(() => checkbox?.click())

    expect(checkbox?.dataset.state).toBe('unchecked')

    act(() => root.unmount())
    container.remove()
  })
})
