import { useMemo } from 'react'
import { File, FileText, Image as ImageIcon } from 'lucide-react'

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
        {/* File attachments displayed above the message, completely separate from message box */}
        {message.attachments && message.attachments.length > 0 && (
          <div className='mb-1 flex justify-end'>
            <div className='flex flex-wrap gap-1.5'>
              {message.attachments.map((attachment) => {
                const isImage = attachment.type.startsWith('image/')
                const getFileIcon = (type: string) => {
                  if (type.includes('pdf'))
                    return <FileText className='h-5 w-5 text-muted-foreground' />
                  if (type.startsWith('image/'))
                    return <ImageIcon className='h-5 w-5 text-muted-foreground' />
                  if (type.includes('text') || type.includes('json'))
                    return <FileText className='h-5 w-5 text-muted-foreground' />
                  return <File className='h-5 w-5 text-muted-foreground' />
                }
                const formatFileSize = (bytes?: number) => {
                  if (!bytes || bytes === 0) return ''
                  const k = 1024
                  const sizes = ['B', 'KB', 'MB', 'GB']
                  const i = Math.floor(Math.log(bytes) / Math.log(k))
                  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                }

                return (
                  <div
                    key={attachment.id}
                    className={`relative overflow-hidden rounded-md border border-border/50 bg-muted/20 ${
                      attachment.dataUrl?.trim() ? 'cursor-pointer' : ''
                    } ${isImage ? 'h-16 w-16' : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2'}`}
                    onClick={(e) => {
                      if (attachment.dataUrl?.trim()) {
                        e.preventDefault()
                        window.open(attachment.dataUrl, '_blank')
                      }
                    }}
                  >
                    {isImage && attachment.dataUrl ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className='h-full w-full object-cover'
                      />
                    ) : (
                      <>
                        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-background/50'>
                          {getFileIcon(attachment.type)}
                        </div>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-foreground text-xs'>
                            {attachment.name}
                          </div>
                          {attachment.size && (
                            <div className='text-[10px] text-muted-foreground'>
                              {formatFileSize(attachment.size)}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className='flex justify-end'>
          <div className='max-w-[80%]'>
            <div className='rounded-[10px] bg-secondary px-3 py-2'>
              {/* Render text content if present and not just file count message */}
              {formattedContent && !formattedContent.startsWith('Uploaded') && (
                <div className='whitespace-pre-wrap break-words font-normal text-foreground text-sm leading-normal'>
                  <WordWrap text={formattedContent} />
                </div>
              )}
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
            <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-gray-400 dark:bg-gray-300' />
          )}
        </div>
      </div>
    </div>
  )
}
