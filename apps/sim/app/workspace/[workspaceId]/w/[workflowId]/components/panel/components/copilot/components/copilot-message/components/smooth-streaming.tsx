import { memo, useEffect, useRef, useState } from 'react'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'

/**
 * Character animation delay in milliseconds
 */
const CHARACTER_DELAY = 3

/**
 * StreamingIndicator shows animated dots during message streaming
 * Used as a standalone indicator when no content has arrived yet
 *
 * @returns Animated loading indicator
 */
export const StreamingIndicator = memo(() => (
  <div className='flex h-[1.25rem] items-center text-muted-foreground'>
    <div className='flex space-x-0.5'>
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms] [animation-duration:1.2s]' />
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] [animation-duration:1.2s]' />
      <div className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] [animation-duration:1.2s]' />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

/**
 * Props for the SmoothStreamingText component
 */
interface SmoothStreamingTextProps {
  /** Content to display with streaming animation */
  content: string
  /** Whether the content is actively streaming */
  isStreaming: boolean
}

/**
 * SmoothStreamingText component displays text with character-by-character animation
 * Creates a smooth streaming effect for AI responses
 *
 * @param props - Component props
 * @returns Streaming text with smooth animation
 */
export const SmoothStreamingText = memo(
  ({ content, isStreaming }: SmoothStreamingTextProps) => {
    // Initialize with full content when not streaming to avoid flash on page load
    const [displayedContent, setDisplayedContent] = useState(() => (isStreaming ? '' : content))
    const contentRef = useRef(content)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    // Initialize index based on streaming state
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
        // Streaming ended - show full content immediately
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
    // Prevent re-renders during streaming unless content actually changed
    return (
      prevProps.content === nextProps.content && prevProps.isStreaming === nextProps.isStreaming
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'
