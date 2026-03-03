'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/emcn'

/** Props for the Welcome component */
interface WelcomeProps {
  /** Callback when a suggested question is clicked */
  onQuestionClick?: (question: string) => void
  /** Current copilot mode ('ask' for Q&A, 'plan' for planning, 'build' for workflow building) */
  mode?: 'ask' | 'build' | 'plan'
}

/** Welcome screen displaying suggested questions based on current mode */
export function Welcome({ onQuestionClick, mode = 'ask' }: WelcomeProps) {
  const t = useTranslations('panel.copilot_panel.welcome')

  const capabilities =
    mode === 'build'
      ? [
          {
            title: t('build_title'),
            question: t('build_question'),
          },
          {
            title: t('debug_title'),
            question: t('debug_question'),
          },
          {
            title: t('optimize_title'),
            question: t('optimize_question'),
          },
        ]
      : [
          {
            title: t('get_started_title'),
            question: t('get_started_question'),
          },
          {
            title: t('discover_tools_title'),
            question: t('discover_tools_question'),
          },
          {
            title: t('create_workflow_title'),
            question: t('create_workflow_question'),
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
            onClick={() => onQuestionClick?.(question)}
            className='w-full justify-start'
          >
            <div className='flex flex-col items-start'>
              <p className='font-medium'>{title}</p>
              <p className='text-[var(--text-secondary)]'>{question}</p>
            </div>
          </Button>
        ))}
      </div>

      {/* Tips */}
      <p className='pt-[12px] text-center text-[13px] text-[var(--text-secondary)]'>
        {t('mention_tip', { symbol: t('mention_symbol') })}
      </p>
    </div>
  )
}
