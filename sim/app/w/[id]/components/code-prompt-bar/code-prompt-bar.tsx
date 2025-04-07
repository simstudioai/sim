import { SendIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CodePromptBarProps {
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

export function CodePromptBar({
  isVisible,
  isLoading,
  isStreaming,
  promptValue,
  onSubmit,
  onCancel,
  onChange,
  placeholder = 'Describe the JavaScript code to generate...',
  className,
}: CodePromptBarProps) {
  if (!isVisible && !isStreaming) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute -top-20 left-0 right-0',
        'bg-background rounded-xl shadow-lg border',
        'transition-all duration-200 z-9999999',
        className
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <div className={cn('status-indicator ml-1', isStreaming && 'streaming')} />

        <div className="flex-1 relative">
          <Input
            value={isStreaming ? 'Generating...' : promptValue}
            onChange={(e) => !isStreaming && onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              'rounded-xl border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-foreground placeholder:text-muted-foreground/50',
              isStreaming && 'text-primary',
              (isLoading || isStreaming) && 'loading-placeholder'
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && !isStreaming && promptValue.trim()) {
                onSubmit(promptValue)
              } else if (e.key === 'Escape') {
                onCancel()
              }
            }}
            disabled={isLoading || isStreaming}
            autoFocus={!isStreaming}
          />
          {isStreaming && (
            <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
              <div className="shimmer-effect" />
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          <XIcon className="h-4 w-4" />
        </Button>

        {!isStreaming && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onSubmit(promptValue)}
            className="h-8 w-8 rounded-full text-primary hover:text-primary hover:bg-primary/10"
            disabled={isLoading || isStreaming || !promptValue.trim()}
          >
            <SendIcon className="h-4 w-4" />
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
