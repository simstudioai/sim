'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Mic } from 'lucide-react'

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null
  onend: ((this: SpeechRecognition, ev: Event) => any) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionStatic
    webkitSpeechRecognition?: SpeechRecognitionStatic
  }
}

interface VoiceInputProps {
  onVoiceStart: () => void
  isListening?: boolean
  disabled?: boolean
  large?: boolean
}

export function VoiceInput({
  onVoiceStart,
  isListening = false,
  disabled = false,
  large = false,
}: VoiceInputProps) {
  const [isSupported, setIsSupported] = useState(false)

  // Check if speech recognition is supported
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setIsSupported(!!SpeechRecognition)
  }, [])

  const handleVoiceClick = useCallback(() => {
    if (disabled) return
    onVoiceStart()
  }, [disabled, onVoiceStart])

  if (!isSupported) {
    return null
  }

  if (large) {
    return (
      <div className='flex flex-col items-center'>
        {/* Large Voice Button */}
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
      {/* Voice Button */}
      <motion.button
        type='button'
        onClick={handleVoiceClick}
        disabled={disabled}
        className={`flex items-center justify-center rounded-full p-2 transition-all duration-200 ${
          isListening
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title='Start voice conversation'
      >
        <Mic size={16} />
      </motion.button>
    </div>
  )
}
