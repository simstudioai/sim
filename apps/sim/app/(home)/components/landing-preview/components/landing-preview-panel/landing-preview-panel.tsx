'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { BubbleChatPreview, ChevronDown, MoreHorizontal, Play } from '@/components/emcn'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'

/**
 * Stores the prompt in browser storage and redirects to /signup.
 * Shared by both the copilot panel and the landing home view.
 */
export function useLandingSubmit() {
  const router = useRouter()
  return useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      LandingPromptStorage.store(trimmed)
      router.push('/signup')
    },
    [router]
  )
}

/**
 * Lightweight static panel replicating the real workspace panel styling.
 * The copilot tab is active with a functional user input.
 * When submitted, stores the prompt and redirects to /signup (same as landing hero).
 *
 * Structure mirrors the real Panel component:
 *   aside > div.border-l.pt-3.5 > Header(px-8) > Tabs(px-8,pt-14) > Content(pt-12)
 *     inside Content > Copilot > header-bar(mx-[-1px]) > UserInput(p-8)
 */
export const LandingPreviewPanel = memo(function LandingPreviewPanel() {
  const landingSubmit = useLandingSubmit()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

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

  return (
    <div className='flex h-full w-[280px] flex-shrink-0 flex-col bg-[var(--surface-1)]'>
      <div className='flex h-full flex-col border-[var(--surface-active)] border-l pt-3.5'>
        {/* Header — More + Chat | Deploy + Run */}
        <div className='flex flex-shrink-0 items-center justify-between px-2'>
          <div className='pointer-events-none flex gap-1.5'>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
              <MoreHorizontal className='h-[14px] w-[14px] text-[var(--text-primary)]' />
            </div>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
              <BubbleChatPreview className='h-[14px] w-[14px] text-[var(--text-primary)]' />
            </div>
          </div>
          <Link
            href='/signup'
            className='flex gap-1.5'
            onMouseMove={(e) => setCursorPos({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setCursorPos(null)}
          >
            <div className='flex h-[30px] items-center rounded-[5px] bg-[var(--brand-tertiary-2)] px-2.5 transition-colors hover:bg-[#2DAC72]'>
              <span className='font-medium text-[var(--bg)] text-caption'>Deploy</span>
            </div>
            <div className='flex h-[30px] items-center gap-2 rounded-[5px] bg-[var(--brand-tertiary-2)] px-2.5 transition-colors hover:bg-[#2DAC72]'>
              <Play className='h-[11.5px] w-[11.5px] text-[var(--bg)]' />
              <span className='font-medium text-[var(--bg)] text-caption'>Run</span>
            </div>
          </Link>
          {cursorPos &&
            createPortal(
              <div
                className='pointer-events-none fixed z-[9999]'
                style={{ left: cursorPos.x + 14, top: cursorPos.y + 14 }}
              >
                {/* Decorative color bars — mirrors hero top-right block sequence */}
                <div className='flex h-[4px]'>
                  <div className='h-full w-[8px] bg-[#2ABBF8]' />
                  <div className='h-full w-[14px] bg-[#2ABBF8] opacity-60' />
                  <div className='h-full w-[8px] bg-[#00F701]' />
                  <div className='h-full w-[16px] bg-[#00F701] opacity-60' />
                  <div className='h-full w-[8px] bg-[#FFCC02]' />
                  <div className='h-full w-[10px] bg-[#FFCC02] opacity-60' />
                  <div className='h-full w-[8px] bg-[#FA4EDF]' />
                  <div className='h-full w-[14px] bg-[#FA4EDF] opacity-60' />
                </div>
                <div className='flex items-center gap-[5px] bg-white px-1.5 py-1 font-medium text-[var(--text-primary)] text-xs'>
                  Get started
                  <ChevronDown className='-rotate-90 h-[7px] w-[7px] text-[var(--text-primary)]' />
                </div>
              </div>,
              document.body
            )}
        </div>

        {/* Tabs */}
        <div className='flex flex-shrink-0 items-center px-2 pt-3.5'>
          <div className='pointer-events-none flex gap-1'>
            <div className='flex h-[28px] items-center rounded-md border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-[5px]'>
              <span className='font-medium text-[var(--text-primary)] text-[12.5px]'>Copilot</span>
            </div>
            <div className='flex h-[28px] items-center rounded-md border border-transparent px-2 py-[5px]'>
              <span className='font-medium text-[var(--text-muted)] text-[12.5px]'>Toolbar</span>
            </div>
            <div className='flex h-[28px] items-center rounded-md border border-transparent px-2 py-[5px]'>
              <span className='font-medium text-[var(--text-muted)] text-[12.5px]'>Editor</span>
            </div>
          </div>
        </div>

        {/* Tab content — copilot */}
        <div className='flex flex-1 flex-col overflow-hidden pt-3'>
          <div className='flex h-full flex-col'>
            {/* Copilot header bar — matches mx-[-1px] in real copilot */}
            <div className='pointer-events-none mx-[-1px] flex flex-shrink-0 items-center rounded-sm border border-[var(--surface-active)] bg-[#292929] px-3 py-1.5'>
              <span className='truncate font-medium text-[var(--text-primary)] text-sm'>New Chat</span>
            </div>

            {/* User input — matches real UserInput at p-2 inside copilot welcome state */}
            <div className='px-2 pt-3 pb-2'>
              <div className='rounded-sm border border-[var(--border-1)] bg-[#292929] px-1.5 py-1.5'>
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Build an AI agent...'
                  rows={2}
                  className='mb-1.5 min-h-[48px] w-full cursor-text resize-none border-0 bg-transparent px-0.5 py-1 font-base text-[var(--text-primary)] text-sm leading-[1.25rem] placeholder-[#787878] caret-[#e6e6e6] outline-none'
                />
                <div className='flex items-center justify-end'>
                  <button
                    type='button'
                    onClick={handleSubmit}
                    disabled={isEmpty}
                    className='flex h-[22px] w-[22px] items-center justify-center rounded-full border-0 p-0 transition-colors'
                    style={{
                      background: isEmpty ? '#808080' : '#e0e0e0',
                      cursor: isEmpty ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <ArrowUp size={14} strokeWidth={2.25} color='#1b1b1b' />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
