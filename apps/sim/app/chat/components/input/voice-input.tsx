'use client'

import { useCallback } from 'react'
import { motion } from 'framer-motion'
import { Mic } from 'lucide-react'

interface VoiceInputProps {
  onVoiceStart: () => void
  isListening?: boolean
  disabled?: boolean
  large?: boolean
  minimal?: boolean
}

export function VoiceInput({
  onVoiceStart,
  isListening = false,
  disabled = false,
  large = false,
  minimal = false,
}: VoiceInputProps) {
  const handleVoiceClick = useCallback(() => {
    if (disabled) return
    onVoiceStart()
  }, [disabled, onVoiceStart])

  if (minimal) {
    return (
      <button
        type='button'
        onClick={handleVoiceClick}
        disabled={disabled}
        className={`flex items-center justify-center rounded-full p-1.5 text-gray-600 transition-colors duration-200 hover:bg-gray-100 md:p-2 ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        }`}
        title='Start voice conversation'
      >
        <Mic size={16} className='md:h-5 md:w-5' />
      </button>
    )
  }

  if (large) {
    return (
      <div className='flex flex-col items-center'>
        <motion.button
          type='button'
          onClick={handleVoiceClick}
          disabled={disabled}
          className={`flex items-center justify-center rounded-full border-2 p-6 transition-all duration-200 ${
            isListening
              ? 'border-red-400 bg-red-500/20 text-red-600 hover:bg-red-500/30'
              : 'border-blue-300 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'
          } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title='Start voice conversation'
        >
          <Mic size={32} />
        </motion.button>
      </div>
    )
  }

  return (
    <div className='flex items-center'>
      <motion.button
        type='button'
        onClick={handleVoiceClick}
        disabled={disabled}
        className={`flex items-center justify-center rounded-full p-2.5 transition-all duration-200 md:p-3 ${
          isListening
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-black text-white hover:bg-zinc-700'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title='Start voice conversation'
      >
        <Mic size={16} className='md:hidden' />
        <Mic size={18} className='hidden md:block' />
      </motion.button>
    </div>
  )
}
