import { memo, useEffect, useRef, useState } from 'react'
import CopilotMarkdownRenderer from './markdown-renderer'

export const StreamingIndicator = memo(() => (
  <div className='flex items-center py-1 text-muted-foreground transition-opacity duration-200 ease-in-out'>
    <div className='flex space-x-0.5'>
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0ms', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.15s', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.3s', animationDuration: '1.2s' }}
      />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

interface SmoothStreamingTextProps {
  content: string
  isStreaming: boolean
}

export const SmoothStreamingText = memo(
  ({ content, isStreaming }: SmoothStreamingTextProps) => {
    const [displayedContent, setDisplayedContent] = useState('')
    const contentRef = useRef(content)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const indexRef = useRef(0)
    const streamingStartTimeRef = useRef<number | null>(null)
    const isAnimatingRef = useRef(false)

    useEffect(() => {
      // Update content reference
      contentRef.current = content

      if (content.length === 0) {
        setDisplayedContent('')
        indexRef.current = 0
        streamingStartTimeRef.current = null
        return
      }

      if (isStreaming) {
        // Start timing when streaming begins
        if (streamingStartTimeRef.current === null) {
          streamingStartTimeRef.current = Date.now()
        }

        // Continue animation if there's more content to show
        if (indexRef.current < content.length) {
          const animateText = () => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current

            if (currentIndex < currentContent.length) {
              // Add characters one by one for true character-by-character streaming
              const chunkSize = 1
              const newDisplayed = currentContent.slice(0, currentIndex + chunkSize)

              setDisplayedContent(newDisplayed)
              indexRef.current = currentIndex + chunkSize

              // Consistent fast speed for all characters
              const delay = 3 // Consistent fast delay in ms for all characters

              timeoutRef.current = setTimeout(animateText, delay)
            } else {
              // Animation complete
              isAnimatingRef.current = false
            }
          }

          // Only start new animation if not already animating
          if (!isAnimatingRef.current) {
            // Clear any existing animation
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current)
            }

            isAnimatingRef.current = true
            // Continue animation from current position
            animateText()
          }
        }
      } else {
        // Not streaming, show all content immediately and reset timing
        setDisplayedContent(content)
        indexRef.current = content.length
        isAnimatingRef.current = false
        streamingStartTimeRef.current = null
      }

      // Cleanup on unmount
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        isAnimatingRef.current = false
      }
    }, [content, isStreaming])

    return (
      <div className='relative max-w-full overflow-hidden' style={{ minHeight: '1.25rem' }}>
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

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

export const WordWrap = ({ text }: { text: string }) => {
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
