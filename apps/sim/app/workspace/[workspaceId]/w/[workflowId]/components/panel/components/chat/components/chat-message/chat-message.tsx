import { useMemo } from 'react'

interface ChatMessageProps {
  message: {
    id: string
    content: any
    timestamp: string | Date
    type: 'user' | 'workflow'
    isStreaming?: boolean
  }
}

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

const WordWrap = ({ text }: { text: string }) => {
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

export function ChatMessage({ message }: ChatMessageProps) {
  // Format message content as text
  const formattedContent = useMemo(() => {
    if (typeof message.content === 'object' && message.content !== null) {
      return JSON.stringify(message.content, null, 2)
    }
    return String(message.content || '')
  }, [message.content])

  // Render human messages as chat bubbles
  if (message.type === 'user') {
    return (
      <div className='w-full py-2'>
        <div className='flex justify-end'>
          <div className='max-w-[80%]'>
            <div className='rounded-[10px] bg-secondary px-3 py-2'>
              <div className='whitespace-pre-wrap break-words font-normal text-foreground text-sm leading-normal'>
                <WordWrap text={formattedContent} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render agent/workflow messages as full-width text
  return (
    <div className='w-full py-2 pl-[2px]'>
      <div className='overflow-wrap-anywhere relative whitespace-normal break-normal font-normal text-sm leading-normal'>
        <div className='whitespace-pre-wrap break-words text-foreground'>
          <WordWrap text={formattedContent} />
          {message.isStreaming && (
            <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-primary' />
          )}
        </div>
      </div>
    </div>
  )
}
