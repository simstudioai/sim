'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import Link from 'next/link'
import { useLandingSubmit } from '@/app/(home)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { useAnimatedPlaceholder } from '@/app/workspace/[workspaceId]/home/hooks/use-animated-placeholder'

const MAX_HEIGHT = 120

const CTA_BUTTON =
  'inline-flex items-center h-[32px] rounded-[5px] border px-[10px] font-[430] font-season text-[14px]'

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
    <div className='flex flex-col items-center px-4 pt-[120px] pb-[100px] sm:px-8 md:px-[80px]'>
      <h2 className='text-center font-[430] font-season text-[#1C1C1C] text-[28px] leading-[100%] tracking-[-0.02em] sm:text-[32px] md:text-[36px]'>
        What should we get done?
      </h2>

      <div className='mt-8 w-full max-w-[42rem]'>
        <div
          className='cursor-text rounded-[20px] border border-[#E5E5E5] bg-white px-[10px] py-[8px] shadow-sm'
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={animatedPlaceholder}
            rows={2}
            className='m-0 box-border min-h-[48px] w-full resize-none border-0 bg-transparent px-[4px] py-[4px] font-body text-[#1C1C1C] text-[15px] leading-[24px] tracking-[-0.015em] outline-none placeholder:font-[380] placeholder:text-[#999] focus-visible:ring-0'
            style={{ caretColor: '#1C1C1C', maxHeight: `${MAX_HEIGHT}px` }}
          />
          <div className='flex items-center justify-end'>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={isEmpty}
              className='flex h-[28px] w-[28px] items-center justify-center rounded-full border-0 p-0 transition-colors'
              style={{
                background: isEmpty ? '#C0C0C0' : '#1C1C1C',
                cursor: isEmpty ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowUp size={16} strokeWidth={2.25} color='#FFFFFF' />
            </button>
          </div>
        </div>
      </div>

      <div className='mt-8 flex gap-[8px]'>
        <a
          href='https://docs.sim.ai'
          target='_blank'
          rel='noopener noreferrer'
          className={`${CTA_BUTTON} border-[#D4D4D4] text-[#1C1C1C] transition-colors hover:bg-[#E8E8E8]`}
        >
          Docs
        </a>
        <Link
          href='/signup'
          className={`${CTA_BUTTON} gap-[8px] border-[#1C1C1C] bg-[#1C1C1C] text-white transition-colors hover:border-[#333] hover:bg-[#333]`}
        >
          Get started
        </Link>
      </div>
    </div>
  )
}
