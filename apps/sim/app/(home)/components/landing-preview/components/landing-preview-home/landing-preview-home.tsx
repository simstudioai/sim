'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useLandingSubmit } from '@/app/(home)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { useAnimatedPlaceholder } from '@/app/workspace/[workspaceId]/home/hooks/use-animated-placeholder'

const C = {
  SURFACE: '#292929',
  BORDER: '#3d3d3d',
  TEXT_PRIMARY: '#e6e6e6',
} as const

/**
 * Landing preview replica of the workspace Home initial view.
 * Shows a greeting heading and a minimal chat input (no + or mic).
 * On submit, stores the prompt and redirects to /signup.
 */
export const LandingPreviewHome = memo(function LandingPreviewHome() {
  const landingSubmit = useLandingSubmit()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const animatedPlaceholder = useAnimatedPlaceholder()

  const isEmpty = inputValue.trim().length === 0

  const handleSubmit = useCallback(() => {
    if (isEmpty) return
    landingSubmit(inputValue)
  }, [isEmpty, inputValue, landingSubmit])

  const MAX_HEIGHT = 200

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
    <div className='flex min-w-0 flex-1 flex-col items-center justify-center px-[24px] pb-[2vh]'>
      <p
        role='presentation'
        className='mb-[24px] max-w-[42rem] font-[430] font-season text-[32px] tracking-[-0.02em]'
        style={{ color: C.TEXT_PRIMARY }}
      >
        What should we get done?
      </p>

      <div className='w-full max-w-[32rem]'>
        <div
          className='cursor-text rounded-[20px] border px-[10px] py-[8px]'
          style={{ borderColor: C.BORDER, backgroundColor: C.SURFACE }}
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={animatedPlaceholder}
            rows={1}
            className='m-0 box-border min-h-[24px] w-full resize-none overflow-y-auto border-0 bg-transparent px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em] outline-none placeholder:font-[380] placeholder:text-[#787878] focus-visible:ring-0'
            style={{
              color: C.TEXT_PRIMARY,
              caretColor: C.TEXT_PRIMARY,
              maxHeight: `${MAX_HEIGHT}px`,
            }}
          />
          <div className='flex items-center justify-end'>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={isEmpty}
              className='flex h-[28px] w-[28px] items-center justify-center rounded-full border-0 p-0 transition-colors'
              style={{
                background: isEmpty ? '#808080' : '#e0e0e0',
                cursor: isEmpty ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowUp size={16} strokeWidth={2.25} color='#1b1b1b' />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
