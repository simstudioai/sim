'use client'

import { Blocks, Bot, LibraryBig, Workflow } from 'lucide-react'

interface CopilotWelcomeProps {
  onQuestionClick?: (question: string) => void
  mode?: 'ask' | 'agent'
}

export function CopilotWelcome({ onQuestionClick, mode = 'ask' }: CopilotWelcomeProps) {
  const handleQuestionClick = (question: string) => {
    onQuestionClick?.(question)
  }

  const subtitle =
    mode === 'ask'
      ? 'Ask about workflows, tools, or how to get started'
      : 'Build, edit, and optimize workflows'

  const capabilities =
    mode === 'agent'
      ? [
          {
            title: 'Build & edit workflows',
            question: 'Help me build a workflow',
            Icon: Workflow,
          },
          {
            title: 'Optimize workflows',
            question: 'Help me optimize my workflow',
            Icon: Blocks,
          },
          {
            title: 'Debug workflows',
            question: 'Help me debug my workflow',
            Icon: LibraryBig,
          },
        ]
      : [
          {
            title: 'Understand my workflow',
            question: 'What does my workflow do?',
            Icon: Workflow,
          },
          {
            title: 'Discover tools',
            question: 'What tools are available?',
            Icon: Blocks,
          },
          {
            title: 'Get started',
            question: 'How do I create a workflow?',
            Icon: LibraryBig,
          },
        ]

  return (
    <div className='relative h-full w-full overflow-hidden px-4 pt-8 pb-6'>
      <div className='relative mx-auto w-full max-w-xl'>
        {/* Header */}
        <div className='flex flex-col items-center text-center'>
          <Bot className='h-12 w-12 text-[var(--brand-primary-hover-hex)]' strokeWidth={1.5} />
          <h3 className='mt-2 font-medium text-foreground text-lg sm:text-xl'>{subtitle}</h3>
        </div>

        {/* Unified capability cards */}
        <div className='mt-7 space-y-2.5'>
          {capabilities.map(({ title, question, Icon }, idx) => (
            <button
              key={idx}
              type='button'
              onClick={() => handleQuestionClick(question)}
              className='w-full rounded-[10px] border bg-background/60 p-3 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary-hover-hex)]/30'
            >
              <div className='flex items-start gap-2'>
                <div className='mt-0.5 flex h-6 w-6 items-center justify-center rounded bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_16%,transparent)] text-[var(--brand-primary-hover-hex)]'>
                  <Icon className='h-3.5 w-3.5' />
                </div>
                <div>
                  <div className='font-medium text-xs'>{title}</div>
                  <p className='mt-1 text-[11px] text-muted-foreground'>{question}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Tips */}
        <div className='mt-6 text-center text-[11px] text-muted-foreground'>
          <p>
            Tip: Use <span className='font-medium text-foreground'>@</span> to reference chats,
            workflows, knowledge, blocks, or templates
          </p>
          <p className='mt-1.5'>Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  )
}
