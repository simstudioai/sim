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
 * Returns appropriate icon for file type
 */
const getFileIcon = (type: string) => {
  if (type.includes('pdf')) return <FileText className='h-5 w-5 text-muted-foreground' />
  if (type.startsWith('image/')) return <ImageIcon className='h-5 w-5 text-muted-foreground' />
  if (type.includes('text') || type.includes('json'))
    return <FileText className='h-5 w-5 text-muted-foreground' />
  return <File className='h-5 w-5 text-muted-foreground' />
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
  const formattedContent = useMemo(() => {
    if (typeof message.content === 'object' && message.content !== null) {
      return JSON.stringify(message.content, null, 2)
    }
    return String(message.content || '')
  }, [message.content])

  const handleAttachmentClick = (attachment: ChatAttachment) => {
    const validDataUrl = attachment.dataUrl?.trim()
    if (validDataUrl?.startsWith('data:')) {
      openImageInNewWindow(validDataUrl, attachment.name)
    }
  }

  if (message.type === 'user') {
    return (
      <div className='w-full max-w-full overflow-hidden opacity-100 transition-opacity duration-200'>
        {message.attachments && message.attachments.length > 0 && (
          <div className='mb-2 flex flex-wrap gap-1.5'>
            {message.attachments.map((attachment) => {
              const isImage = attachment.type.startsWith('image/')
              const hasValidDataUrl =
                attachment.dataUrl?.trim() && attachment.dataUrl.startsWith('data:')

              return (
                <div
                  key={attachment.id}
                  className={`relative overflow-hidden rounded-md border border-border/50 bg-muted/20 ${
                    hasValidDataUrl ? 'cursor-pointer' : ''
                  } ${isImage ? 'h-16 w-16' : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2'}`}
                  onClick={(e) => {
                    if (hasValidDataUrl) {
                      e.preventDefault()
                      e.stopPropagation()
                      handleAttachmentClick(attachment)
                    }
                  }}
                >
                  {isImage && hasValidDataUrl ? (
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
        )}

        {formattedContent && !formattedContent.startsWith('Uploaded') && (
          <div className='rounded-[4px] border border-[#3D3D3D] bg-[#282828] px-[8px] py-[6px] transition-all duration-200 dark:border-[#3D3D3D] dark:bg-[#363636]'>
            <div className='whitespace-pre-wrap break-words font-medium font-sans text-[#0D0D0D] text-sm leading-[1.25rem] dark:text-gray-100'>
              <WordWrap text={formattedContent} />
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='w-full max-w-full overflow-hidden pl-[2px] opacity-100 transition-opacity duration-200'>
      <div className='whitespace-pre-wrap break-words font-[470] font-season text-[#707070] text-sm leading-[1.25rem] dark:text-[#E8E8E8]'>
        <WordWrap text={formattedContent} />
        {message.isStreaming && (
          <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-gray-400 dark:bg-gray-300' />
        )}
      </div>
    </div>
  )
}
