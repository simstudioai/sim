'use client'

import { Bot } from 'lucide-react'

interface CopilotWelcomeProps {
  onQuestionClick?: (question: string) => void
  mode?: 'ask' | 'agent'
}

export function CopilotWelcome({ onQuestionClick, mode = 'ask' }: CopilotWelcomeProps) {
  const askQuestions = [
    'How do I create a workflow?',
    'What tools are available?',
    'What does my workflow do?',
  ]

  const agentQuestions = [
    'Help me build a workflow',
    'Help me optimize my workflow',
    'Help me debug my workflow',
  ]

  const exampleQuestions = mode === 'ask' ? askQuestions : agentQuestions

  const handleQuestionClick = (question: string) => {
    onQuestionClick?.(question)
  }

  return (
    <div className='flex h-full flex-col items-center justify-center px-4 py-10'>
      <div className='space-y-6 text-center'>
        <Bot className='mx-auto h-12 w-12 text-muted-foreground' />
        <div className='space-y-2'>
          <h3 className='font-medium text-lg'>How can I help you today?</h3>
          <p className='text-muted-foreground text-sm'>
            {mode === 'ask'
              ? 'Ask me anything about your workflows, available tools, or how to get started.'
              : 'I can help you build, edit, and optimize workflows. What would you like to do?'}
          </p>
        </div>
        <div className='mx-auto max-w-sm space-y-3'>
          <div className='font-medium text-muted-foreground text-xs'>Try asking:</div>
          <div className='flex flex-wrap justify-center gap-2'>
            {exampleQuestions.map((question, index) => (
              <button
                key={index}
                className='inline-flex cursor-pointer items-center rounded-full bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground text-xs transition-all hover:scale-105 hover:bg-muted hover:text-foreground active:scale-95'
                onClick={() => handleQuestionClick(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
