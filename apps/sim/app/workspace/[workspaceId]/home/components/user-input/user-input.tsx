'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Mic, Paperclip } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useAnimatedPlaceholder } from '../../hooks'

const TEXTAREA_CLASSES = cn(
  'm-0 box-border h-auto max-h-[30vh] min-h-[24px] w-full resize-none',
  'overflow-y-auto overflow-x-hidden break-words border-0 bg-transparent',
  'px-[4px] py-[4px] font-body text-[15px] leading-[24px] tracking-[-0.015em]',
  'text-[var(--text-primary)] outline-none',
  'placeholder:font-[380] placeholder:text-[var(--text-subtle)]',
  'focus-visible:ring-0 focus-visible:ring-offset-0',
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
)

const SEND_BUTTON_BASE = 'h-[28px] w-[28px] rounded-full border-0 p-0 transition-colors'
const SEND_BUTTON_ACTIVE =
  'bg-[var(--c-383838)] hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
const SEND_BUTTON_DISABLED = 'bg-[var(--c-808080)] dark:bg-[var(--c-808080)]'

function autoResizeTextarea(e: React.FormEvent<HTMLTextAreaElement>) {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${Math.min(target.scrollHeight, window.innerHeight * 0.3)}px`
}

interface UserInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isSending: boolean
  onStopGeneration: () => void
  isInitialView?: boolean
}

export function UserInput({
  value,
  onChange,
  onSubmit,
  isSending,
  onStopGeneration,
  isInitialView = true,
}: UserInputProps) {
  const animatedPlaceholder = useAnimatedPlaceholder()
  const placeholder = isInitialView ? animatedPlaceholder : 'Send message to Sim'
  const canSubmit = value.trim().length > 0 && !isSending

  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const prefixRef = useRef('')

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    },
    [onSubmit]
  )

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      recognitionRef.current = null
      setIsListening(false)
      return
    }

    const w = window as Window & {
      SpeechRecognition?: typeof SpeechRecognition
      webkitSpeechRecognition?: typeof SpeechRecognition
    }
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    prefixRef.current = value

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const prefix = prefixRef.current
      onChange(prefix ? `${prefix} ${transcript}` : transcript)
    }

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        try {
          recognition.start()
        } catch {
          recognitionRef.current = null
          setIsListening(false)
        }
      }
    }
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'aborted' || e.error === 'not-allowed') {
        recognitionRef.current = null
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [isListening, value, onChange])

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        'mx-auto w-full max-w-[640px] cursor-text rounded-[20px] border border-[var(--border-1)] bg-[var(--white)] px-[10px] py-[8px] dark:bg-[var(--surface-4)]',
        isInitialView && 'shadow-sm'
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={autoResizeTextarea}
        placeholder={placeholder}
        rows={1}
        className={TEXTAREA_CLASSES}
      />
      <div className='flex items-center justify-between'>
        <div className='flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-full border border-[#F0F0F0] transition-colors hover:bg-[#F7F7F7] dark:border-[#3d3d3d] dark:hover:bg-[#303030]'>
          <Paperclip
            className='h-[14px] w-[14px] text-[var(--text-muted)] dark:text-[var(--text-secondary)]'
            strokeWidth={2}
          />
        </div>
        <div className='flex items-center gap-[6px]'>
          <button
            type='button'
            onClick={toggleListening}
            className={cn(
              'flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors',
              isListening
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-[var(--text-muted)] hover:bg-[#F7F7F7] dark:text-[var(--text-secondary)] dark:hover:bg-[#303030]'
            )}
            title={isListening ? 'Stop listening' : 'Voice input'}
          >
            <Mic className='h-[16px] w-[16px]' strokeWidth={2} />
          </button>
          {isSending ? (
            <Button
              onClick={onStopGeneration}
              className={cn(SEND_BUTTON_BASE, SEND_BUTTON_ACTIVE)}
              title='Stop generation'
            >
              <svg
                className='block h-[14px] w-[14px] fill-white dark:fill-black'
                viewBox='0 0 24 24'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
              </svg>
            </Button>
          ) : (
            <Button
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                SEND_BUTTON_BASE,
                canSubmit ? SEND_BUTTON_ACTIVE : SEND_BUTTON_DISABLED
              )}
            >
              <ArrowUp
                className='block h-[16px] w-[16px] text-white dark:text-black'
                strokeWidth={2.25}
              />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
