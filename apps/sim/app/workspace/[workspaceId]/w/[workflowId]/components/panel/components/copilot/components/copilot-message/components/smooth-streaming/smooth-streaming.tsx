import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { CopilotMarkdownRenderer } from '../markdown-renderer'

/** Character animation delay in milliseconds */
const CHARACTER_DELAY = 3

/** Props for the StreamingIndicator component */
interface StreamingIndicatorProps {
  /** Optional class name for layout adjustments */
  className?: string
}

/** Shows animated dots during message streaming when no content has arrived */
export const StreamingIndicator = memo(({ className }: StreamingIndicatorProps) => (
  <div className={cn('flex h-[1.25rem] items-center text-muted-foreground', className)}>
    <div className='flex space-x-0.5'>
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms] [animation-duration:1.2s]' />
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] [animation-duration:1.2s]' />
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] [animation-duration:1.2s]' />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

/** Props for the SmoothStreamingText component */
interface SmoothStreamingTextProps {
  /** Content to display with streaming animation */
  content: string
  /** Whether the content is actively streaming */
  isStreaming: boolean
}

/** Displays text with character-by-character animation for smooth streaming */
export const SmoothStreamingText = memo(
  ({ content, isStreaming }: SmoothStreamingTextProps) => {
    const [displayedContent, setDisplayedContent] = useState(() => (isStreaming ? '' : content))
    const contentRef = useRef(content)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const indexRef = useRef(isStreaming ? 0 : content.length)
    const isAnimatingRef = useRef(false)

    useEffect(() => {
      contentRef.current = content

      if (content.length === 0) {
        setDisplayedContent('')
        indexRef.current = 0
        return
      }

      if (isStreaming) {
        if (indexRef.current < content.length) {
          const animateText = () => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current

            if (currentIndex < currentContent.length) {
              const newDisplayed = currentContent.slice(0, currentIndex + 1)
              setDisplayedContent(newDisplayed)
              indexRef.current = currentIndex + 1
              timeoutRef.current = setTimeout(animateText, CHARACTER_DELAY)
            } else {
              isAnimatingRef.current = false
            }
          }

          if (!isAnimatingRef.current) {
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current)
            }
            isAnimatingRef.current = true
            animateText()
          }
        }
      } else {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        setDisplayedContent(content)
        indexRef.current = content.length
        isAnimatingRef.current = false
      }

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        isAnimatingRef.current = false
      }
    }, [content, isStreaming])

    return (
      <div className='min-h-[1.25rem] max-w-full'>
        <CopilotMarkdownRenderer content={displayedContent} />
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.content === nextProps.content && prevProps.isStreaming === nextProps.isStreaming
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'
