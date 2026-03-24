import { useMemo } from 'react'
import { ChatMessageAttachments } from '@/app/workspace/[workspaceId]/home/components'
import type { ChatMessageAttachment } from '@/app/workspace/[workspaceId]/home/types'
import { useThrottledValue } from '@/hooks/use-throttled-value'

interface ChatMessageProps {
  message: {
    id: string
    content: any
    timestamp: string | Date
    type: 'user' | 'workflow'
    isStreaming?: boolean
    attachments?: ChatMessageAttachment[]
  }
}

const MAX_WORD_LENGTH = 25

function StreamingIndicator() {
  return <span className='inline-block h-[14px] w-[6px] animate-pulse bg-current opacity-70' />
}

/**
 * Component for wrapping long words to prevent overflow
 */
const WordWrap = ({ text }: { text: string }) => {
  if (!text) return null

  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

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

/**
 * Renders a chat message with optional file attachments
 */
export function ChatMessage({ message }: ChatMessageProps) {
  const rawContent = useMemo(() => {
    if (typeof message.content === 'object' && message.content !== null) {
      return JSON.stringify(message.content, null, 2)
    }
    return String(message.content || '')
  }, [message.content])

  const throttled = useThrottledValue(rawContent)
  const formattedContent = message.type === 'user' ? rawContent : throttled

  if (message.type === 'user') {
    const hasAttachments = message.attachments && message.attachments.length > 0
    return (
      <div className='w-full max-w-full overflow-hidden opacity-100 transition-opacity duration-200'>
        {hasAttachments && (
          <ChatMessageAttachments
            attachments={message.attachments!}
            align='start'
            className='mb-[4px]'
          />
        )}

        {formattedContent && !formattedContent.startsWith('Uploaded') && (
          <div className='rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] py-[6px] transition-all duration-200'>
            <div className='whitespace-pre-wrap break-words font-medium font-sans text-[var(--text-primary)] text-sm leading-[1.25rem]'>
              <WordWrap text={formattedContent} />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='w-full max-w-full overflow-hidden pl-[2px] opacity-100 transition-opacity duration-200'>
      <div className='whitespace-pre-wrap break-words font-[470] font-season text-[var(--text-primary)] text-sm leading-[1.25rem]'>
        <WordWrap text={formattedContent} />
        {message.isStreaming && <StreamingIndicator />}
      </div>
    </div>
  )
}
