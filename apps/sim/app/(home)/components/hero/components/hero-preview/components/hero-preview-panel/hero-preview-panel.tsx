'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { BubbleChatPreview, ChevronDown, MoreHorizontal, Play } from '@/components/emcn'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'

/**
 * Lightweight static panel replicating the real workspace panel styling.
 * The copilot tab is active with a functional user input.
 * When submitted, stores the prompt and redirects to /signup (same as landing hero).
 *
 * Structure mirrors the real Panel component:
 *   aside > div.border-l.pt-[14px] > Header(px-8) > Tabs(px-8,pt-14) > Content(pt-12)
 *     inside Content > Copilot > header-bar(mx-[-1px]) > UserInput(p-8)
 */
export const HeroPreviewPanel = memo(function HeroPreviewPanel() {
  const router = useRouter()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  const isEmpty = inputValue.trim().length === 0

  const handleSubmit = useCallback(() => {
    if (isEmpty) return
    LandingPromptStorage.store(inputValue)
    router.push('/signup')
  }, [isEmpty, inputValue, router])

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
    <div className='flex h-full w-[280px] flex-shrink-0 flex-col bg-[#1e1e1e]'>
      <div className='flex h-full flex-col border-[#2c2c2c] border-l pt-[14px]'>
        {/* Header — More + Chat | Deploy + Run */}
        <div className='flex flex-shrink-0 items-center justify-between px-[8px]'>
          <div className='pointer-events-none flex gap-[6px]'>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[#3d3d3d] bg-[#363636]'>
              <MoreHorizontal className='h-[14px] w-[14px] text-[#e6e6e6]' />
            </div>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[#3d3d3d] bg-[#363636]'>
              <BubbleChatPreview className='h-[14px] w-[14px] text-[#e6e6e6]' />
            </div>
          </div>
          <Link
            href='/signup'
            className='flex gap-[6px]'
            onMouseMove={(e) => setCursorPos({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setCursorPos(null)}
          >
            <div className='flex h-[30px] items-center rounded-[5px] bg-[#32bd7e] px-[10px] transition-[filter] hover:brightness-110'>
              <span className='font-medium text-[#1b1b1b] text-[12px]'>Deploy</span>
            </div>
            <div className='flex h-[30px] items-center gap-[8px] rounded-[5px] bg-[#32bd7e] px-[10px] transition-[filter] hover:brightness-110'>
              <Play className='h-[11.5px] w-[11.5px] text-[#1b1b1b]' />
              <span className='font-medium text-[#1b1b1b] text-[12px]'>Run</span>
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
                <div
                  className='flex items-center gap-[5px] bg-white px-[6px] py-[4px] font-medium text-[#1C1C1C] text-[11px]'
                  style={{ boxShadow: '2px 2px 0px 0px #3d3d3d' }}
                >
                  Get started
                  <ChevronDown className='-rotate-90 h-[7px] w-[7px] text-[#1C1C1C]' />
                </div>
              </div>,
              document.body
            )}
        </div>

        {/* Tabs */}
        <div className='flex flex-shrink-0 items-center px-[8px] pt-[14px]'>
          <div className='pointer-events-none flex gap-[4px]'>
            <div className='flex h-[28px] items-center rounded-[6px] border border-[#3d3d3d] bg-[#363636] px-[8px] py-[5px]'>
              <span className='font-medium text-[#e6e6e6] text-[12.5px]'>Copilot</span>
            </div>
            <div className='flex h-[28px] items-center rounded-[6px] border border-transparent px-[8px] py-[5px]'>
              <span className='font-medium text-[#787878] text-[12.5px]'>Toolbar</span>
            </div>
            <div className='flex h-[28px] items-center rounded-[6px] border border-transparent px-[8px] py-[5px]'>
              <span className='font-medium text-[#787878] text-[12.5px]'>Editor</span>
            </div>
          </div>
        </div>

        {/* Tab content — copilot */}
        <div className='flex flex-1 flex-col overflow-hidden pt-[12px]'>
          <div className='flex h-full flex-col'>
            {/* Copilot header bar — matches mx-[-1px] in real copilot */}
            <div className='pointer-events-none mx-[-1px] flex flex-shrink-0 items-center rounded-[4px] border border-[#2c2c2c] bg-[#292929] px-[12px] py-[6px]'>
              <span className='truncate font-medium text-[#e6e6e6] text-[14px]'>New Chat</span>
            </div>

            {/* User input — matches real UserInput at p-[8px] inside copilot welcome state */}
            <div className='px-[8px] pt-[12px] pb-[8px]'>
              <div className='rounded-[4px] border border-[#3d3d3d] bg-[#292929] px-[6px] py-[6px]'>
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Build an AI agent...'
                  rows={2}
                  className='mb-[6px] min-h-[48px] w-full cursor-text resize-none border-0 bg-transparent px-[2px] py-1 font-base text-[#e6e6e6] text-sm leading-[1.25rem] placeholder-[#787878] caret-[#e6e6e6] outline-none'
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
