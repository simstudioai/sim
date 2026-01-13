import { memo, useEffect, useRef, useState } from 'react'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'

/**
 * Minimum delay between characters (fast catch-up mode)
 */
const MIN_DELAY = 1

/**
 * Maximum delay between characters (when waiting for content)
 */
const MAX_DELAY = 12

/**
 * Default delay when streaming normally
 */
const DEFAULT_DELAY = 4

/**
 * How far behind (in characters) before we speed up
 */
const CATCH_UP_THRESHOLD = 20

/**
 * How close to content before we slow down
 */
const SLOW_DOWN_THRESHOLD = 5

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
 * InlineStreamingDots shows small animated dots inline with text
 * Used at the end of streaming content to indicate more is coming
 */
const InlineStreamingDots = memo(() => (
  <span className='ml-1 inline-flex items-center align-middle'>
    <span className='inline-flex space-x-0.5'>
      <span className='inline-block h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms] [animation-duration:1.2s]' />
      <span className='inline-block h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] [animation-duration:1.2s]' />
      <span className='inline-block h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] [animation-duration:1.2s]' />
    </span>
  </span>
))

InlineStreamingDots.displayName = 'InlineStreamingDots'

/**
 * Props for the SmoothStreamingText component
 */
interface SmoothStreamingTextProps {
  /** Content to display with streaming animation */
  content: string
  /** Whether the content is actively streaming */
  isStreaming: boolean
  /** Whether to show inline streaming dots at the end of content. Defaults to true. */
  showIndicator?: boolean
}

/**
 * Calculates adaptive delay based on how far behind animation is from actual content
 *
 * @param displayedLength - Current displayed content length
 * @param totalLength - Total available content length
 * @returns Delay in milliseconds
 */
function calculateAdaptiveDelay(displayedLength: number, totalLength: number): number {
  const charsRemaining = totalLength - displayedLength

  if (charsRemaining > CATCH_UP_THRESHOLD) {
    // Far behind - speed up to catch up
    // Scale from MIN_DELAY to DEFAULT_DELAY based on how far behind
    const catchUpFactor = Math.min(1, (charsRemaining - CATCH_UP_THRESHOLD) / 50)
    return MIN_DELAY + (DEFAULT_DELAY - MIN_DELAY) * (1 - catchUpFactor)
  }

  if (charsRemaining <= SLOW_DOWN_THRESHOLD) {
    // Close to content edge - slow down to feel natural
    // The closer we are, the slower we go (up to MAX_DELAY)
    const slowFactor = 1 - charsRemaining / SLOW_DOWN_THRESHOLD
    return DEFAULT_DELAY + (MAX_DELAY - DEFAULT_DELAY) * slowFactor
  }

  // Normal streaming speed
  return DEFAULT_DELAY
}

/**
 * SmoothStreamingText component displays text with character-by-character animation
 * Creates a smooth streaming effect for AI responses with adaptive speed
 *
 * Uses adaptive pacing: speeds up when catching up, slows down near content edge
 *
 * @param props - Component props
 * @returns Streaming text with smooth animation
 */
export const SmoothStreamingText = memo(
  ({ content, isStreaming, showIndicator = true }: SmoothStreamingTextProps) => {
    const [displayedContent, setDisplayedContent] = useState('')
    const contentRef = useRef(content)
    const rafRef = useRef<number | null>(null)
    const indexRef = useRef(0)
    const lastFrameTimeRef = useRef<number>(0)
    const isAnimatingRef = useRef(false)

    useEffect(() => {
      contentRef.current = content

      if (content.length === 0) {
        setDisplayedContent('')
        indexRef.current = 0
        return
      }

      if (isStreaming) {
        if (indexRef.current < content.length && !isAnimatingRef.current) {
          isAnimatingRef.current = true
          lastFrameTimeRef.current = performance.now()

          const animateText = (timestamp: number) => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current
            const elapsed = timestamp - lastFrameTimeRef.current

            // Calculate adaptive delay based on how far behind we are
            const delay = calculateAdaptiveDelay(currentIndex, currentContent.length)

            if (elapsed >= delay) {
              if (currentIndex < currentContent.length) {
                const newDisplayed = currentContent.slice(0, currentIndex + 1)
                setDisplayedContent(newDisplayed)
                indexRef.current = currentIndex + 1
                lastFrameTimeRef.current = timestamp
              }
            }

            if (indexRef.current < currentContent.length) {
              rafRef.current = requestAnimationFrame(animateText)
            } else {
              isAnimatingRef.current = false
            }
          }

          rafRef.current = requestAnimationFrame(animateText)
        } else if (indexRef.current < content.length && isAnimatingRef.current) {
          // Animation already running, it will pick up new content automatically
        }
      } else {
        // Streaming ended - show full content immediately
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
        }
        setDisplayedContent(content)
        indexRef.current = content.length
        isAnimatingRef.current = false
      }

      return () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current)
        }
        isAnimatingRef.current = false
      }
    }, [content, isStreaming])

    // Show inline dots when streaming and we have some content displayed (if enabled)
    const showInlineDots = showIndicator && isStreaming && displayedContent.length > 0

    return (
      <div className='relative min-h-[1.25rem] max-w-full overflow-hidden'>
        <CopilotMarkdownRenderer content={displayedContent} />
        {showInlineDots && <InlineStreamingDots />}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Prevent re-renders during streaming unless content actually changed
    return (
      prevProps.content === nextProps.content &&
      prevProps.isStreaming === nextProps.isStreaming &&
      prevProps.showIndicator === nextProps.showIndicator
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'
