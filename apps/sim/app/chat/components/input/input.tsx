'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { VoiceInput } from '@/app/chat/components/input/voice-input'

const PLACEHOLDER_MOBILE = 'Enter a message'
const PLACEHOLDER_DESKTOP = 'Enter a message or click the mic to speak'
const MAX_TEXTAREA_HEIGHT = 120 // Max height in pixels (e.g., for about 3-4 lines)
const MAX_TEXTAREA_HEIGHT_MOBILE = 100 // Smaller for mobile

export const ChatInput: React.FC<{
  onSubmit?: (value: string, isVoiceInput?: boolean) => void
  isStreaming?: boolean
  onStopStreaming?: () => void
  onVoiceStart?: () => void
  voiceOnly?: boolean
}> = ({ onSubmit, isStreaming = false, onStopStreaming, onVoiceStart, voiceOnly = false }) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Ref for the textarea
  const [isActive, setIsActive] = useState(false)
  const [inputValue, setInputValue] = useState('')

  // Check if speech-to-text is available in the browser
  const isSttAvailable =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  // Function to adjust textarea height
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto' // Reset height to correctly calculate scrollHeight
      const scrollHeight = el.scrollHeight

      // Use mobile height on mobile devices, desktop height on desktop
      const isMobile = window.innerWidth < 768
      const maxHeight = isMobile ? MAX_TEXTAREA_HEIGHT_MOBILE : MAX_TEXTAREA_HEIGHT

      if (scrollHeight > maxHeight) {
        el.style.height = `${maxHeight}px`
        el.style.overflowY = 'auto'
      } else {
        el.style.height = `${scrollHeight}px`
        el.style.overflowY = 'hidden'
      }
    }
  }

  // Adjust height on input change
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputValue])

  // Close the input when clicking outside (only when empty)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        if (!inputValue) {
          setIsActive(false)
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto' // Reset height
            textareaRef.current.style.overflowY = 'hidden' // Ensure overflow is hidden
          }
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inputValue])

  // Handle focus and initial height when activated
  useEffect(() => {
    if (isActive && textareaRef.current) {
      textareaRef.current.focus()
      adjustTextareaHeight() // Adjust height when becoming active
    }
  }, [isActive])

  const handleActivate = () => {
    setIsActive(true)
    // Focus is now handled by the useEffect above
  }

  const handleSubmit = () => {
    if (!inputValue.trim()) return
    onSubmit?.(inputValue.trim(), false) // false = not voice input
    setInputValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto' // Reset height after submit
      textareaRef.current.style.overflowY = 'hidden' // Ensure overflow is hidden
    }
    setIsActive(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
  }

  // Handle voice start with smooth transition to voice-first mode
  const handleVoiceStart = () => {
    onVoiceStart?.() // This will trigger the voice-first mode transition
  }

  // Voice-only mode interface (for voice-first UI)
  if (voiceOnly) {
    return (
      <div className='flex items-center justify-center'>
        {/* Voice Input Only */}
        {isSttAvailable && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <VoiceInput onVoiceStart={handleVoiceStart} disabled={isStreaming} large={true} />
                </div>
              </TooltipTrigger>
              <TooltipContent side='top' className='border border-gray-200 bg-white text-gray-900'>
                <p>Start voice conversation</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    )
  }

  return (
    <>
      <div className='fixed right-0 bottom-0 left-0 flex w-full items-center justify-center bg-gradient-to-t from-white to-transparent px-4 pb-4 text-black md:px-0 md:pb-4'>
        <div ref={wrapperRef} className='w-full max-w-3xl md:max-w-[748px]'>
          {/* Text Input Area with Controls */}
          <motion.div
            className='rounded-2xl border border-gray-200 bg-white shadow-sm md:rounded-3xl'
            onClick={handleActivate}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className='flex items-center gap-2 p-3 md:p-4'>
              {/* Voice Input */}
              {isSttAvailable && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <VoiceInput
                          onVoiceStart={handleVoiceStart}
                          disabled={isStreaming}
                          minimal
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side='top'>
                      <p>Start voice conversation</p>
                      <span className='text-gray-500 text-xs'>Click to enter voice mode</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Text Input Container */}
              <div className='relative flex-1'>
                <textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  className='flex w-full resize-none items-center overflow-hidden bg-transparent text-base outline-none placeholder:text-gray-400 md:font-[330]'
                  placeholder={isActive ? '' : ''}
                  rows={1}
                  style={{
                    minHeight: window.innerWidth >= 768 ? '24px' : '28px',
                    lineHeight: '1.4',
                    paddingTop: window.innerWidth >= 768 ? '4px' : '3px',
                    paddingBottom: window.innerWidth >= 768 ? '4px' : '3px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />

                {/* Placeholder */}
                <div className='pointer-events-none absolute top-0 left-0 flex h-full w-full items-center'>
                  {!isActive && !inputValue && (
                    <>
                      {/* Mobile placeholder */}
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 transform select-none text-base text-gray-400 md:hidden'
                        style={{ paddingTop: '3px', paddingBottom: '3px' }}
                      >
                        {PLACEHOLDER_MOBILE}
                      </div>
                      {/* Desktop placeholder */}
                      <div
                        className='-translate-y-1/2 absolute top-1/2 left-0 hidden transform select-none font-[330] text-base text-gray-400 md:block'
                        style={{ paddingTop: '4px', paddingBottom: '4px' }}
                      >
                        {PLACEHOLDER_DESKTOP}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Send Button */}
              <button
                className={`flex items-center justify-center rounded-full p-1.5 text-white transition-colors md:p-2 ${
                  inputValue.trim()
                    ? 'bg-black hover:bg-zinc-700'
                    : 'cursor-default bg-gray-300 hover:bg-gray-400'
                }`}
                title={isStreaming ? 'Stop' : 'Send'}
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  if (isStreaming) {
                    onStopStreaming?.()
                  } else {
                    handleSubmit()
                  }
                }}
              >
                {isStreaming ? (
                  <>
                    <Square size={16} className='md:hidden' />
                    <Square size={18} className='hidden md:block' />
                  </>
                ) : (
                  <>
                    <Send size={16} className='md:hidden' />
                    <Send size={18} className='hidden md:block' />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  )
}
