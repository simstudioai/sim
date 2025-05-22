'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Send, Square } from 'lucide-react'

// We only need a single placeholder
const PLACEHOLDER = 'Enter a message'

// Variants for the input container expansion/collapse
const containerVariants = {
  collapsed: {
    height: 68,
    boxShadow: '0 2px 10px 0 rgba(0,0,0,0.1)',
    transition: { type: 'spring', stiffness: 120, damping: 18 },
  },
  expanded: {
    height: 68,
    boxShadow: '0 8px 32px 0 rgba(0,0,0,0.18)',
    transition: { type: 'spring', stiffness: 120, damping: 18 },
  },
} as const

// Variants for animated placeholder letters
const placeholderContainerVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.025 } },
  exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
}

const letterVariants = {
  initial: {
    opacity: 0,
    filter: 'blur(12px)',
    y: 10,
  },
  animate: {
    opacity: 1,
    filter: 'blur(0px)',
    y: 0,
    transition: {
      opacity: { duration: 0.25 },
      filter: { duration: 0.4 },
      y: { type: 'spring', stiffness: 80, damping: 20 },
    },
  },
  exit: {
    opacity: 0,
    filter: 'blur(12px)',
    y: -10,
    transition: {
      opacity: { duration: 0.2 },
      filter: { duration: 0.3 },
      y: { type: 'spring', stiffness: 80, damping: 20 },
    },
  },
}

/**
 * Animated chat-style input inspired by popular AI chat interfaces.
 *
 * NOTE:  This component is totally self-contained – it does **NOT** perform any
 * actual network calls.  You should supply `onSubmit` / `onChange` handlers from
 * the parent if you need to hook it up to your chat logic.
 */
export const ChatInput: React.FC<{
  /**
   * Callback fired when the user presses the send button or hits `Enter`.
   */
  onSubmit?: (value: string) => void
  /**
   * Whether the chat is currently streaming a response
   */
  isStreaming?: boolean
  /**
   * Callback fired when the user presses the stop button
   */
  onStopStreaming?: () => void
}> = ({ onSubmit, isStreaming = false, onStopStreaming }) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isActive, setIsActive] = useState(false)
  const [inputValue, setInputValue] = useState('')

  // Close the input when clicking outside (only when empty)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        if (!inputValue) setIsActive(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [inputValue])

  const handleActivate = () => setIsActive(true)

  const handleSubmit = () => {
    if (!inputValue.trim()) return
    onSubmit?.(inputValue.trim())
    setInputValue('')
    setIsActive(false)
  }

  return (
    <div className="w-full flex justify-center items-center text-black">
      <motion.div
        ref={wrapperRef}
        className="w-full max-w-3xl"
        variants={containerVariants}
        animate={isActive || inputValue ? 'expanded' : 'collapsed'}
        initial="collapsed"
        style={{
          overflow: 'hidden',
          borderRadius: 32,
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.1)',
        }}
        onClick={handleActivate}
      >
        <div className="flex flex-col items-stretch w-full h-full">
          {/* Input Row */}
          <div className="flex items-center gap-3 p-3 rounded-full bg-white max-w-3xl w-full">
            {/* Text Input & Placeholder */}
            <div className="relative flex-1 ml-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                className="flex-1 border-0 outline-0 rounded-md py-2 px-1 text-base bg-transparent w-full font-normal"
                style={{ position: 'relative', zIndex: 1 }}
                onFocus={handleActivate}
                placeholder=" " /* keep native placeholder empty – we draw ours */
              />
              <div className="absolute left-0 top-0 w-full h-full pointer-events-none flex items-center px-3 py-2">
                {!isActive && !inputValue && (
                  <AnimatePresence mode="wait">
                    <motion.span
                      key="placeholder"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 select-none"
                      style={{ whiteSpace: 'nowrap', zIndex: 0 }}
                      variants={placeholderContainerVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {PLACEHOLDER.split('').map((char, i) => (
                        <motion.span
                          key={i}
                          variants={letterVariants}
                          style={{ display: 'inline-block' }}
                        >
                          {char === ' ' ? '\u00A0' : char}
                        </motion.span>
                      ))}
                    </motion.span>
                  </AnimatePresence>
                )}
              </div>
            </div>

            <button
              className="flex items-center gap-1 bg-black hover:bg-zinc-700 text-white p-3 rounded-full font-medium justify-center"
              title={isStreaming ? 'Stop' : 'Send'}
              type="button"
              tabIndex={-1}
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
        </div>
      </motion.div>
    </div>
  )
}
