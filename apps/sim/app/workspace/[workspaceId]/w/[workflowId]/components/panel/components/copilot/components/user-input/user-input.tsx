'use client'

import { type FC, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2, MessageCircle, Package, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface UserInputProps {
  onSubmit: (message: string) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  mode?: 'ask' | 'agent'
  onModeChange?: (mode: 'ask' | 'agent') => void
  value?: string // Controlled value from outside
  onChange?: (value: string) => void // Callback when value changes
}

const UserInput: FC<UserInputProps> = ({
  onSubmit,
  onAbort,
  disabled = false,
  isLoading = false,
  isAborting = false,
  placeholder = 'How can I help you today?',
  className,
  mode = 'agent',
  onModeChange,
  value: controlledValue,
  onChange: onControlledChange,
}) => {
  const [internalMessage, setInternalMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Use controlled value if provided, otherwise use internal state
  const message = controlledValue !== undefined ? controlledValue : internalMessage
  const setMessage =
    controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px` // Max height of 120px
    }
  }, [message])

  const handleSubmit = () => {
    const trimmedMessage = message.trim()
    if (!trimmedMessage || disabled || isLoading) return

    onSubmit(trimmedMessage)
    // Clear the message after submit
    if (controlledValue !== undefined) {
      onControlledChange?.('')
    } else {
      setInternalMessage('')
    }
  }

  const handleAbort = () => {
    if (onAbort && isLoading) {
      onAbort()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    if (controlledValue !== undefined) {
      onControlledChange?.(newValue)
    } else {
      setInternalMessage(newValue)
    }
  }

  const canSubmit = message.trim().length > 0 && !disabled && !isLoading
  const showAbortButton = isLoading && onAbort

  const handleModeToggle = () => {
    if (onModeChange) {
      onModeChange(mode === 'ask' ? 'agent' : 'ask')
    }
  }

  const getModeIcon = () => {
    return mode === 'ask' ? (
      <MessageCircle className='h-3 w-3 text-muted-foreground' />
    ) : (
      <Package className='h-3 w-3 text-muted-foreground' />
    )
  }

  return (
    <div className={cn('relative flex-none pb-4', className)}>
      <div className='rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs dark:border-[#414141] dark:bg-[#202020]'>
        {/* Textarea Field */}
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className='mb-2 min-h-[32px] w-full resize-none overflow-hidden border-0 bg-transparent px-[2px] py-1 text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          style={{ height: 'auto' }}
        />

        {/* Bottom Row: Mode Selector + Send Button */}
        <div className='flex items-center justify-between'>
          {/* Mode Selector Tag */}
          <Button
            variant='ghost'
            size='sm'
            onClick={handleModeToggle}
            disabled={!onModeChange}
            className='flex h-6 items-center gap-1.5 rounded-full bg-secondary px-2 py-1 font-medium text-secondary-foreground text-xs hover:bg-secondary/80'
          >
            {getModeIcon()}
            <span className='capitalize'>{mode}</span>
          </Button>

          {/* Send Button */}
          {showAbortButton ? (
            <Button
              onClick={handleAbort}
              disabled={isAborting}
              size='icon'
              className='h-6 w-6 rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
              title='Stop generation'
            >
              {isAborting ? (
                <Loader2 className='h-3 w-3 animate-spin' />
              ) : (
                <X className='h-3 w-3' />
              )}
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              size='icon'
              className='h-6 w-6 rounded-full bg-[#802FFF] text-white shadow-[0_0_0_0_#802FFF] transition-all duration-200 hover:bg-[#7028E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
            >
              {isLoading ? (
                <Loader2 className='h-3 w-3 animate-spin' />
              ) : (
                <ArrowUp className='h-3 w-3' />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export { UserInput }
