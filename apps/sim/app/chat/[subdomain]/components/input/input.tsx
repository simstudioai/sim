'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { VoiceInput } from './voice-input'

const PLACEHOLDER = 'Enter a message or click the mic to speak'
const MAX_TEXTAREA_HEIGHT = 160 // Max height in pixels (e.g., for about 4-5 lines)

const containerVariants = {
  collapsed: {
    height: '56px', // Fixed height when collapsed
    boxShadow: '0 1px 6px 0 rgba(0,0,0,0.05)',
  },
  expanded: {
    height: 'auto',
    boxShadow: '0 2px 10px 0 rgba(0,0,0,0.1)',
  },
} as const

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

      if (scrollHeight > MAX_TEXTAREA_HEIGHT) {
        el.style.height = `${MAX_TEXTAREA_HEIGHT}px`
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
      <div className='fixed right-0 bottom-0 left-0 flex w-full items-center justify-center bg-gradient-to-t from-white to-transparent pb-4 text-black'>
        <motion.div
          ref={wrapperRef}
          className='w-full max-w-3xl px-4'
          variants={containerVariants}
          animate={'expanded'}
          initial='collapsed'
          style={{
            overflow: 'hidden',
            borderRadius: 32,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.1)',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
          onClick={handleActivate}
        >
          <div className='flex h-full w-full items-center rounded-full p-2'>
            {/* Voice Input with Tooltip */}
            {isSttAvailable && (
              <div className='mr-2'>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <VoiceInput onVoiceStart={handleVoiceStart} disabled={isStreaming} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side='top'>
                      <p>Start voice conversation</p>
                      <span className='text-gray-500 text-xs'>Click to enter voice mode</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Text Input & Placeholder */}
            <div className='relative min-h-[40px] flex-1'>
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInputChange}
                className='w-full resize-none overflow-hidden bg-transparent px-3 py-3 text-base outline-none placeholder:text-gray-400'
                placeholder={isActive ? '' : ''}
                rows={1}
                style={{
                  minHeight: '40px',
                  lineHeight: '1.4',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
              />

              <div className='pointer-events-none absolute top-0 left-0 flex h-full w-full items-center'>
                {!isActive && !inputValue && (
                  <div
                    className='-translate-y-1/2 absolute top-1/2 left-3 select-none text-gray-400'
                    style={{
                      whiteSpace: 'nowrap',
                      zIndex: 0,
                      background:
                        'linear-gradient(90deg, rgba(150,150,150,0.2) 0%, rgba(150,150,150,0.8) 50%, rgba(150,150,150,0.2) 100%)',
                      backgroundSize: '200% 100%',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      animation: 'shimmer 10s infinite linear',
                    }}
                  >
                    {PLACEHOLDER}
                    <style jsx global>{`
                      @keyframes shimmer {
                        0% {
                          background-position: 200% 0;
                        }
                        100% {
                          background-position: -200% 0;
                        }
                      }
                    `}</style>
                  </div>
                )}
              </div>
            </div>

            <button
              className='flex items-center justify-center rounded-full bg-black p-3 text-white hover:bg-zinc-700'
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
              {isStreaming ? <Square size={18} /> : <Send size={18} />}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  )
}
