import { useEffect, useRef, useState } from 'react'
import { SendIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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

  // Reset the exit state when visibility changes
  useEffect(() => {
    if (isVisible) {
      setIsExiting(false)
    }
  }, [isVisible])

  if (!isVisible && !isStreaming && !isExiting) {
    return null
  }

  return (
    <div
      ref={promptBarRef}
      className={cn(
        '-top-20 absolute right-0 left-0',
        'rounded-xl border bg-background shadow-lg',
        'z-9999999 transition-all duration-150',
        isExiting ? 'opacity-0' : 'opacity-100',
        className
      )}
    >
      <div className='flex items-center gap-2 p-2'>
        <div className={cn('status-indicator ml-1', isStreaming && 'streaming')} />

        <div className='relative flex-1'>
          <Input
            value={isStreaming ? 'Generating...' : promptValue}
            onChange={(e) => !isStreaming && onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              'rounded-xl border-0 text-foreground text-sm placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0',
              isStreaming && 'text-primary',
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
            autoFocus={!isStreaming}
          />
          {isStreaming && (
            <div className='pointer-events-none absolute inset-0 h-full w-full overflow-hidden'>
              <div className='shimmer-effect' />
            </div>
          )}
        </div>

        <Button
          variant='ghost'
          size='icon'
          onClick={handleCancel}
          className='h-8 w-8 rounded-full text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        >
          <XIcon className='h-4 w-4' />
        </Button>

        {!isStreaming && (
          <Button
            variant='ghost'
            size='icon'
            onClick={() => onSubmit(promptValue)}
            className='h-8 w-8 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-foreground'
            disabled={isLoading || isStreaming || !promptValue.trim()}
          >
            <SendIcon className='h-4 w-4' />
          </Button>
        )}
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes smoke-pulse {
          0%,
          100% {
            transform: scale(0.8);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }

        .status-indicator {
          position: relative;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          overflow: hidden;
          background-color: hsl(var(--muted-foreground) / 0.5);
          transition: background-color 0.3s ease;
        }

        .status-indicator.streaming {
          background-color: transparent;
        }

        .status-indicator.streaming::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(
            circle,
            hsl(var(--primary) / 0.7) 0%,
            hsl(var(--primary) / 0.2) 60%,
            transparent 80%
          );
          animation: smoke-pulse 1.8s ease-in-out infinite;
        }

        .shimmer-effect {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          animation: shimmer 2s infinite;
        }

        .dark .shimmer-effect {
          background: linear-gradient(
            90deg,
            rgba(50, 50, 50, 0) 0%,
            rgba(80, 80, 80, 0.4) 50%,
            rgba(50, 50, 50, 0) 100%
          );
        }
      `}</style>
    </div>
  )
}
