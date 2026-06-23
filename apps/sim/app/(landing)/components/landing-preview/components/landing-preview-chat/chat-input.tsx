'use client'

import { useRef } from 'react'
import { ArrowUp, Mic, Paperclip, Slash } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface LandingPreviewChatInputProps {
  value: string
  onChange?: (value: string) => void
  onSubmit: () => void
  placeholder: string
  /** Locks the field (used while the demo auto-types). */
  readOnly?: boolean
  /** Hides the caret (auto-type has no real cursor). */
  caretHidden?: boolean
  /** Lifts the field with the home-view shadow (only the initial empty state). */
  shadow?: boolean
}

const ICON_BUTTON =
  'flex size-[28px] flex-shrink-0 items-center justify-center rounded-full transition-colors hover-hover:bg-[#f0f0f0]'

/**
 * The canonical Mothership chat input — a faithful copy of the workspace
 * `UserInput`: a white, `rounded-[17px]` field with the text area on top and a
 * control row beneath (attach + skills on the left, mic + send on the right).
 * The send button carries the real `SEND_BUTTON` fills (`#383838` active,
 * `#808080` disabled). Shared by the home empty state and the docked chat pane
 * so both read identically.
 */
export function LandingPreviewChatInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  readOnly = false,
  caretHidden = false,
  shadow = false,
}: LandingPreviewChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isEmpty = value.trim().length === 0

  return (
    <div
      onClick={() => textareaRef.current?.focus()}
      className={cn(
        'cursor-text rounded-[17px] border border-[#e6e6e6] bg-[#ffffff] px-2.5 py-2',
        shadow && 'shadow-[0_1px_2px_0_rgba(18,18,18,0.05)]'
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          if (!readOnly) onChange?.(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={placeholder}
        rows={1}
        readOnly={readOnly}
        className='m-0 block max-h-[200px] min-h-[24px] w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 font-body text-[#121212] text-[15px] leading-[24px] tracking-[-0.015em] outline-none placeholder:font-[380] placeholder:text-[#5f5f5f] focus-visible:ring-0'
        style={{ caretColor: caretHidden ? 'transparent' : '#121212' }}
      />

      <div className='mt-1 flex items-center justify-between'>
        <div className='flex items-center gap-1'>
          <span className={ICON_BUTTON}>
            <Paperclip className='size-[16px] text-[#5f5f5f]' />
          </span>
          <span className={ICON_BUTTON}>
            <Slash className='size-[16px] text-[#5f5f5f]' />
          </span>
        </div>
        <div className='flex items-center gap-1.5'>
          <span className={ICON_BUTTON}>
            <Mic className='size-[16px] text-[#5f5f5f]' />
          </span>
          <button
            type='button'
            onClick={onSubmit}
            disabled={isEmpty}
            aria-label='Send message'
            className={cn(
              'flex size-[28px] flex-shrink-0 items-center justify-center rounded-full border-0 p-0 transition-colors',
              isEmpty ? 'cursor-not-allowed bg-[#808080]' : 'bg-[#383838] hover-hover:bg-[#575757]'
            )}
          >
            <ArrowUp className='size-[16px] text-white' />
          </button>
        </div>
      </div>
    </div>
  )
}
