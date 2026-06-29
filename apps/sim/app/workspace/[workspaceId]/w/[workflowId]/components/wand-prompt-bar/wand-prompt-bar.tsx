import { useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { SendIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WandPromptBarProps {
  isVisible: boolean
  isLoading: boolean
  isStreaming: boolean
  promptValue: string
  onSubmit: (prompt: string) => void
  onCancel: () => void
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function WandPromptBar({
  isVisible,
  isLoading,
  isStreaming,
  promptValue,
  onSubmit,
  onCancel,
  onChange,
  placeholder = 'Describe what you want to generate...',
  className,
}: WandPromptBarProps) {
  const promptBarRef = useRef<HTMLDivElement>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [prevIsVisible, setPrevIsVisible] = useState(isVisible)
  if (isVisible !== prevIsVisible) {
    setPrevIsVisible(isVisible)
    if (isVisible) setIsExiting(false)
  }

  // Handle the fade-out animation
  const handleCancel = () => {
    if (!isLoading && !isStreaming) {
      setIsExiting(true)
      // Wait for animation to complete before actual cancellation
      setTimeout(() => {
        setIsExiting(false)
        onCancel()
      }, 150) // Matches the CSS transition duration
    }
  }

  useEffect(() => {
    // Handle click outside
    const handleClickOutside = (event: MouseEvent) => {
      if (
        promptBarRef.current &&
        !promptBarRef.current.contains(event.target as Node) &&
        isVisible &&
        !isStreaming &&
        !isLoading &&
        !isExiting
      ) {
        handleCancel()
      }
    }

    // Add event listener
    document.addEventListener('mousedown', handleClickOutside)

    // Cleanup event listener
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isVisible, isStreaming, isLoading, isExiting, onCancel])

  if (!isVisible && !isStreaming && !isExiting) {
    return null
  }

  return (
    <div
      ref={promptBarRef}
      className={cn(
        '-translate-y-3 absolute right-0 bottom-full left-0 gap-2',
        'rounded-lg border bg-background shadow-lg',
        'z-9999999 transition-all duration-150',
        isExiting ? 'opacity-0' : 'opacity-100',
        className
      )}
    >
      <div className='flex items-center gap-2 p-2'>
        <div className={cn('status-indicator ml-2 self-center', isStreaming && 'streaming')} />

        <div className='relative flex-1'>
          <input
            type='text'
            value={isStreaming ? 'Generating...' : promptValue}
            onChange={(e) => !isStreaming && onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
            className={cn(
              'flex h-10 w-full rounded-xl bg-input-background px-3 py-2 text-foreground text-sm outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50',
              isStreaming && 'text-foreground/70',
              (isLoading || isStreaming) && 'loading-placeholder'
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && !isStreaming && promptValue.trim()) {
                onSubmit(promptValue)
              } else if (e.key === 'Escape') {
                handleCancel()
              }
            }}
            disabled={isLoading || isStreaming}
          />
        </div>

        <Button
          variant='ghost'
          size='icon'
          onClick={handleCancel}
          className='size-8 rounded-full text-muted-foreground hover-hover:bg-accent/50 hover-hover:text-foreground'
        >
          <XIcon className='size-4' />
        </Button>

        {!isStreaming && (
          <Button
            variant='ghost'
            size='icon'
            onClick={() => onSubmit(promptValue)}
            className='size-8 rounded-full text-muted-foreground hover-hover:bg-primary/10 hover-hover:text-foreground'
            disabled={isLoading || isStreaming || !promptValue.trim()}
          >
            <SendIcon className='size-4' />
          </Button>
        )}
      </div>
    </div>
  )
}
