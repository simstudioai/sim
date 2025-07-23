'use client'

import { type FC, type KeyboardEvent, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ProfessionalInputProps {
  onSubmit: (message: string) => void
  disabled?: boolean
  isLoading?: boolean
  placeholder?: string
  className?: string
}

const ProfessionalInput: FC<ProfessionalInputProps> = ({
  onSubmit,
  disabled = false,
  isLoading = false,
  placeholder = 'How can I help you today?',
  className,
}) => {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const trimmedMessage = message.trim()
    if (!trimmedMessage || disabled || isLoading) return

    onSubmit(trimmedMessage)
    setMessage('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }

  const canSubmit = message.trim().length > 0 && !disabled && !isLoading

  return (
    <div className={cn('w-full max-w-full overflow-hidden bg-background p-4', className)}>
      <div className='mx-auto w-full max-w-3xl'>
        <div className='relative w-full max-w-full'>
          <div className='relative flex w-full max-w-full items-end rounded-2xl border border-border bg-background shadow-sm transition-all focus-within:border-primary focus-within:ring-1 focus-within:ring-primary'>
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || isLoading}
              className='max-h-[120px] min-h-[50px] w-full max-w-full resize-none border-0 bg-transparent px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
              rows={1}
            />
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              size='icon'
              className={cn(
                'absolute right-2 bottom-2 h-8 w-8 rounded-xl transition-all',
                canSubmit
                  ? 'bg-[#802FFF] text-white shadow-sm hover:bg-[#7028E6]'
                  : 'cursor-not-allowed bg-muted text-muted-foreground'
              )}
            >
              {isLoading ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <ArrowUp className='h-4 w-4' />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ProfessionalInput }
