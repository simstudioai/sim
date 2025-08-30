'use client'

import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { soehne } from '@/app/fonts/soehne/soehne'

export default function Hero() {
  const [textValue, setTextValue] = useState('')
  const isEmpty = textValue.trim().length === 0

  const handleSubmit = () => {
    // Function left empty for now as requested
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isEmpty) {
        handleSubmit()
      }
    }
  }

  return (
    <div
      className={`${soehne.className} flex w-full flex-col items-center justify-center gap-[2px] pt-[80px]`}
    >
      <h1 className='font-medium text-[74px] tracking-tight'>Workflows for LLMs</h1>
      <h2 className='text-center font-normal text-[22px] opacity-70'>
        Build and deploy AI agent workflows.
      </h2>
      <div className='relative flex items-center justify-center pt-8'>
        <textarea
          placeholder='Ask Sim to build an agent to read my emails...'
          className='h-[120px] w-[640px] resize-none px-4 py-3 font-normal'
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            borderRadius: 16,
            border: 'var(--border-width-border, 1px) solid #EEE9FC',
            outline: 'none',
            background: '#FDFCFF',
            boxShadow:
              'var(--shadow-xs-offset-x, 0) var(--shadow-xs-offset-y, 2px) var(--shadow-xs-blur-radius, 4px) var(--shadow-xs-spread-radius, 0) var(--shadow-xs-color, rgba(0, 0, 0, 0.08))',
          }}
        />
        <button
          key={isEmpty ? 'empty' : 'filled'}
          type='button'
          aria-label='Submit description'
          className='absolute right-3 bottom-3 flex items-center justify-center transition-all duration-200'
          disabled={isEmpty}
          onClick={handleSubmit}
          style={{
            width: 34,
            height: 34,
            padding: '3.75px 3.438px 3.75px 4.063px',
            borderRadius: 55,
            ...(isEmpty
              ? {
                  border: '0.625px solid #E0E0E0',
                  background: '#E5E5E5',
                  boxShadow: 'none',
                  cursor: 'not-allowed',
                }
              : {
                  border: '0.625px solid #343434',
                  background: 'linear-gradient(180deg, #060606 0%, #323232 100%)',
                  boxShadow: '0 1.25px 2.5px 0 #9B77FF inset',
                  cursor: 'pointer',
                }),
          }}
        >
          <ArrowUp size={20} color={isEmpty ? '#999999' : '#FFFFFF'} />
        </button>
      </div>
    </div>
  )
}
