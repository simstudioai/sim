'use client'

import { Button } from '@/components/emcn'

/**
 * Props for the CopilotWelcome component
 */
interface WelcomeProps {
  /** Callback when a suggested question is clicked */
  onQuestionClick?: (question: string) => void
  /** Current copilot mode ('ask' for Q&A, 'agent' for workflow building) */
  mode?: 'ask' | 'agent'
}

/**
 * Welcome screen component for the copilot
 * Displays suggested questions and capabilities based on current mode
 *
 * @param props - Component props
 * @returns Welcome screen UI
 */
export function Welcome({ onQuestionClick, mode = 'ask' }: WelcomeProps) {
  /**
   * Handles click on a suggested question
   * @param question - The question text to submit
   */
  const handleQuestionClick = (question: string) => {
    onQuestionClick?.(question)
  }

  const capabilities =
    mode === 'agent'
      ? [
          {
            title: 'Build',
            question: 'Help me build a workflow',
          },
          {
            title: 'Debug',
            question: 'Help debug my workflow',
          },
          {
            title: 'Optimize',
            question: 'Create a fast workflow',
          },
        ]
      : [
          {
            title: 'Get started',
            question: 'Help me get started',
          },
          {
            title: 'Discover tools',
            question: 'What tools are available?',
          },
          {
            title: 'Create workflow',
            question: 'How do I create a workflow?',
          },
        ]

  return (
    <div className='flex w-full flex-col items-center'>
      {/* Unified capability cards */}
      <div className='flex w-full flex-col items-center gap-[8px]'>
        {capabilities.map(({ title, question }, idx) => (
          <Button
            key={idx}
            variant='active'
            onClick={() => handleQuestionClick(question)}
            className='w-full justify-start'
          >
            <div className='flex flex-col items-start'>
              <p className='font-medium'>{title}</p>
              <p className='text-[#B1B1B1] dark:text-[#B1B1B1]'>{question}</p>
            </div>
          </Button>
        ))}
      </div>

      {/* Tips */}
      <p className='pt-[12px] text-center text-[#B1B1B1] text-[13px] dark:text-[#B1B1B1]'>
        Tip: Use <span className='font-medium'>@</span> to reference chats, workflows, knowledge,
        blocks, or templates
      </p>
    </div>
  )
}
