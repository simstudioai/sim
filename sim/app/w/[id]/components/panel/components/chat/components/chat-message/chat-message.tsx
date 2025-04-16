import { useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Clock, Terminal, User } from 'lucide-react'
import { JSONView } from '../../../console/components/json-view/json-view'

interface ChatMessageProps {
  message: {
    id: string
    content: any
    timestamp: string | Date
    type: 'user' | 'workflow'
  }
  containerWidth: number
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
          <span key={index} className="break-all">
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}

export function ChatMessage({ message, containerWidth }: ChatMessageProps) {
  const messageDate = useMemo(() => new Date(message.timestamp), [message.timestamp])

  const relativeTime = useMemo(() => {
    return formatDistanceToNow(messageDate, { addSuffix: true })
  }, [messageDate])

  // Check if content is a JSON object
  const isJsonObject = useMemo(() => {
    return typeof message.content === 'object' && message.content !== null
  }, [message.content])

  // Format message content based on type
  const formattedContent = useMemo(() => {
    if (isJsonObject) {
      return JSON.stringify(message.content) // Return stringified version for type safety
    }

    return String(message.content)
  }, [message.content, isJsonObject])

  return (
    <div className="w-full border-b border-border p-4 space-y-4 hover:bg-accent/50 transition-colors">
      {/* Header with time on left and message type on right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{relativeTime}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {message.type !== 'user' && <span className="text-muted-foreground">Workflow</span>}
        </div>
      </div>

      {/* Message content with proper word wrapping */}
      <div className="text-sm font-mono flex-1 break-normal whitespace-normal overflow-wrap-anywhere relative">
        {isJsonObject ? (
          <JSONView data={message.content} initiallyExpanded={false} />
        ) : (
          <div className="whitespace-pre-wrap text-foreground break-words">
            <WordWrap text={formattedContent} />
          </div>
        )}
      </div>
    </div>
  )
}
