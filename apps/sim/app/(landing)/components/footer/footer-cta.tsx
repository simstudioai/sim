'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import Link from 'next/link'
import { useLandingSubmit } from '@/app/(landing)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'

const MAX_HEIGHT = 120

const CTA_BUTTON =
  'inline-flex items-center h-[32px] rounded-[5px] border px-2.5 font-[430] font-season text-sm'

export function FooterCTA() {
  const landingSubmit = useLandingSubmit()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const animatedPlaceholder = useAnimatedPlaceholder()

  const isEmpty = inputValue.trim().length === 0

  const handleSubmit = useCallback(() => {
    if (isEmpty) return
    landingSubmit(inputValue)
  }, [isEmpty, inputValue, landingSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, MAX_HEIGHT)}px`
  }, [])

  return (
    <section
      id='cta'
      aria-labelledby='cta-heading'
      className='flex flex-col items-center px-4 pt-[90px] pb-[90px] sm:px-8 sm:pt-[120px] sm:pb-[120px] md:px-16 md:pt-[150px] md:pb-[150px]'
    >
      <h2
        id='cta-heading'
        className='text-balance text-center font-[430] font-season text-[28px] text-white leading-[100%] tracking-[-0.02em] sm:text-[32px] md:text-[36px]'
      >
        What should we get done?
      </h2>

      <div className='mt-8 w-full max-w-[42rem]'>
        <div
          className='cursor-text rounded-[20px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg-surface)] px-2.5 py-2'
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            aria-label='Describe what you want to build'
            placeholder={animatedPlaceholder}
            rows={2}
            className='m-0 box-border min-h-[48px] w-full resize-none border-0 bg-transparent px-1 py-1 font-body text-[var(--landing-text)] text-base leading-[24px] tracking-[-0.015em] outline-none placeholder:font-[380] placeholder:text-[var(--landing-text-muted)] focus-visible:ring-0'
            style={{ caretColor: '#FFFFFF', maxHeight: `${MAX_HEIGHT}px` }}
          />
          <div className='flex items-center justify-end'>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={isEmpty}
              aria-label='Submit message'
              className='flex h-[28px] w-[28px] items-center justify-center rounded-full border-0 p-0 transition-colors'
              style={{
                background: isEmpty ? '#555555' : '#FFFFFF',
                cursor: isEmpty ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowUp size={16} strokeWidth={2.25} color={isEmpty ? '#888888' : '#1C1C1C'} />
            </button>
          </div>
        </div>
      </div>

      <div className='mt-8 flex gap-2'>
        <a
          href='https://docs.sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className={`${CTA_BUTTON} border-[var(--landing-border-strong)] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]`}
        >
          Docs
        </a>
        <Link
          href='/signup'
          className={`${CTA_BUTTON} gap-2 border-white bg-white text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#E0E0E0]`}
        >
          Get started
        </Link>
      </div>
    </section>
  )
}
