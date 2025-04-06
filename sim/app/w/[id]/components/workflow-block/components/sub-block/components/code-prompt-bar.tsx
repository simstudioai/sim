import { SendIcon, SparklesIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'

const logger = createLogger('CodePromptBar')

interface CodePromptBarProps {
  blockId: string
  subBlockId: string
  isVisible: boolean
  isLoading: boolean
  isStreaming: boolean
  promptValue: string
  onSubmit: (prompt: string) => void
  onCancel: () => void
  onChange: (value: string) => void
  placeholder?: string
}

export function CodePromptBar({
  blockId,
  subBlockId,
  isVisible,
  isLoading,
  isStreaming,
  promptValue,
  onSubmit,
  onCancel,
  onChange,
  placeholder = 'Describe the JavaScript code you want to generate...',
}: CodePromptBarProps) {
  if (!isVisible && !isStreaming) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute -top-20 left-0 right-0',
        'bg-background rounded-xl shadow-lg border',
        'transition-all duration-200 z-9999999'
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <SparklesIcon
          className={cn(
            'h-4 w-4 ml-1',
            isStreaming ? 'text-primary animate-pulse' : 'text-primary'
          )}
        />

        <div className="flex-1 relative">
          <Input
            value={isStreaming ? 'Generating...' : promptValue}
            onChange={(e) => !isStreaming && onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              'rounded-xl border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-foreground placeholder:text-muted-foreground/50',
              isStreaming && 'text-primary'
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
