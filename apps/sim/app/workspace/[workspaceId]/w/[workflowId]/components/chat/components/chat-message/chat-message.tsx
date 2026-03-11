import { useMemo } from 'react'
import { FileText } from 'lucide-react'
import { StreamingIndicator } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/smooth-streaming'
import { useThrottledValue } from '@/hooks/use-throttled-value'

interface ChatAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  size?: number
}

interface ChatMessageProps {
  message: {
    id: string
    content: any
    timestamp: string | Date
    type: 'user' | 'workflow'
    isStreaming?: boolean
    attachments?: ChatAttachment[]
  }
}

const MAX_WORD_LENGTH = 25

/**
 * Formats file size in human-readable format
 */
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes === 0) return ''
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Math.round((bytes / 1024 ** i) * 10) / 10} ${sizes[i]}`
}

/**
 * Opens image attachment in new window
 */
const openImageInNewWindow = (dataUrl: string, fileName: string) => {
  const newWindow = window.open('', '_blank')
  if (!newWindow) return

  newWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${fileName}</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
          img { max-width: 100%; max-height: 100vh; object-fit: contain; }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" alt="${fileName}" />
      </body>
    </html>
  `)
  newWindow.document.close()
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

  const handleAttachmentClick = (attachment: ChatAttachment) => {
    const validDataUrl = attachment.dataUrl?.trim()
    if (validDataUrl?.startsWith('data:')) {
      openImageInNewWindow(validDataUrl, attachment.name)
    }
  }

  if (message.type === 'user') {
    const hasAttachments = message.attachments && message.attachments.length > 0
    return (
      <div className='w-full max-w-full overflow-hidden opacity-100 transition-opacity duration-200'>
        {hasAttachments && (
          <div className='mb-[4px] flex flex-wrap gap-[4px]'>
            {message.attachments!.map((attachment) => {
              const hasValidDataUrl =
                attachment.dataUrl?.trim() && attachment.dataUrl.startsWith('data:')
              const canDisplayAsImage = attachment.type.startsWith('image/') && hasValidDataUrl

              return (
                <div
                  key={attachment.id}
                  className={`flex max-w-[150px] items-center gap-[5px] rounded-[6px] bg-[var(--surface-2)] px-[5px] py-[3px] ${
                    hasValidDataUrl ? 'cursor-pointer' : ''
                  }`}
                  onClick={(e) => {
                    if (hasValidDataUrl) {
                      e.preventDefault()
                      e.stopPropagation()
                      handleAttachmentClick(attachment)
                    }
                  }}
                >
                  {canDisplayAsImage ? (
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className='h-[20px] w-[20px] flex-shrink-0 rounded-[3px] object-cover'
                    />
                  ) : (
                    <FileText className='h-[12px] w-[12px] flex-shrink-0 text-[var(--text-tertiary)]' />
                  )}
                  <span className='truncate text-[10px] text-[var(--text-secondary)]'>
                    {attachment.name}
                  </span>
                </div>
              )
            })}
          </div>
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
