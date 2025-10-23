import { memo, useEffect, useRef, useState } from 'react'
import CopilotMarkdownRenderer from './markdown-renderer'

/**
 * Character animation delay in milliseconds
 */
const CHARACTER_DELAY = 3

/**
 * Maximum word length before breaking
 */
const MAX_WORD_LENGTH = 25

/**
 * StreamingIndicator shows animated dots during message streaming
 * Uses CSS classes for animations to follow best practices
 *
 * @returns Animated loading indicator
 */
export const StreamingIndicator = memo(() => (
  <div className='flex items-center py-1 text-muted-foreground transition-opacity duration-200 ease-in-out'>
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
    const [displayedContent, setDisplayedContent] = useState('')
    const contentRef = useRef(content)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const indexRef = useRef(0)
    const streamingStartTimeRef = useRef<number | null>(null)
    const isAnimatingRef = useRef(false)

    /**
     * Handles content streaming animation
     * Updates displayed content character by character during streaming
     */
    useEffect(() => {
      contentRef.current = content

      if (content.length === 0) {
        setDisplayedContent('')
        indexRef.current = 0
        streamingStartTimeRef.current = null
        return
      }

      if (isStreaming) {
        if (streamingStartTimeRef.current === null) {
          streamingStartTimeRef.current = Date.now()
        }

        if (indexRef.current < content.length) {
          const animateText = () => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current

            if (currentIndex < currentContent.length) {
              const chunkSize = 1
              const newDisplayed = currentContent.slice(0, currentIndex + chunkSize)

              setDisplayedContent(newDisplayed)
              indexRef.current = currentIndex + chunkSize

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
        setDisplayedContent(content)
        indexRef.current = content.length
        isAnimatingRef.current = false
        streamingStartTimeRef.current = null
      }

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        isAnimatingRef.current = false
      }
    }, [content, isStreaming])

    return (
      <div className='relative min-h-[1.25rem] max-w-full overflow-hidden'>
        <CopilotMarkdownRenderer content={displayedContent} />
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Prevent re-renders during streaming unless content actually changed
    return (
      prevProps.content === nextProps.content && prevProps.isStreaming === nextProps.isStreaming
      // markdownComponents is now memoized so no need to compare
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'

/**
 * Props for the WordWrap component
 */
interface WordWrapProps {
  /** Text content to wrap */
  text: string
}

/**
 * WordWrap component breaks up long words to prevent overflow
 * Splits words longer than MAX_WORD_LENGTH into smaller chunks
 *
 * @param props - Component props
 * @returns Wrapped text with break-all applied to long words
 */
export const WordWrap = ({ text }: WordWrapProps) => {
  if (!text) return null

  // Split text into words, keeping spaces and punctuation
  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        // If the part is whitespace or shorter than the max length, render it as is
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

        // For long words, break them up into chunks
        const chunks = []
        for (let i = 0; i < part.length; i += MAX_WORD_LENGTH) {
          chunks.push(part.substring(i, i + MAX_WORD_LENGTH))
        }

        return (
          <span key={index} className='break-all'>
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}
