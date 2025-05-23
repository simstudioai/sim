'use client'

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Send, Square } from 'lucide-react'

const PLACEHOLDER = 'Enter a message'
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
  onSubmit?: (value: string) => void
  isStreaming?: boolean
  onStopStreaming?: () => void
}> = ({ onSubmit, isStreaming = false, onStopStreaming }) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Ref for the textarea
  const [isActive, setIsActive] = useState(false)
  const [inputValue, setInputValue] = useState('')

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
    onSubmit?.(inputValue.trim())
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

  return (
    <div className="w-full flex justify-center items-center text-black fixed bottom-0 left-0 right-0 pb-4 bg-gradient-to-t from-white to-transparent">
      <motion.div
        ref={wrapperRef}
        className="w-full max-w-3xl px-4"
        variants={containerVariants}
        animate={'expanded'}
        initial="collapsed"
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
        <div className="flex items-center w-full h-full p-2 rounded-full">
          {/* Text Input & Placeholder */}
          <div className="relative flex-1 mx-2">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                // Submit on Enter without Shift
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
                // Submit on Cmd/Ctrl + Enter for consistency with other chat apps
                else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit()
                }
                // Allow Enter with Shift for newline by not preventing default
              }}
              className="flex-1 border-0 outline-0 rounded-md py-3 text-base bg-transparent w-full font-normal resize-none transition-height duration-100 ease-out"
              style={{
                position: 'relative',
                zIndex: 1,
                lineHeight: '1.5',
                minHeight: '44px', // Set a fixed min-height for consistent text alignment
                verticalAlign: 'middle',
                paddingLeft: '12px', // Add left padding to move cursor to the right
              }}
              onFocus={handleActivate}
              onBlur={() => {
                if (!inputValue) {
                  setIsActive(false)
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto'
                    textareaRef.current.style.overflowY = 'hidden'
                  }
                }
              }}
              placeholder=" " /* keep native placeholder empty – we draw ours */
            />
            <div className="absolute left-0 top-0 w-full h-full pointer-events-none flex items-center">
              {!isActive && !inputValue && (
                <div
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 select-none"
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
            className="flex items-center justify-center bg-black hover:bg-zinc-700 text-white p-3 rounded-full"
            title={isStreaming ? 'Stop' : 'Send'}
            type="button"
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
  )
}
