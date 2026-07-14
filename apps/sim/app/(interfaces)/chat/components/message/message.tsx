'use client'

import { memo, useState } from 'react'
import { Button, cn, Duplicate, Tooltip } from '@sim/emcn'
import { Check, File as FileIcon, FileText, Image as ImageIcon } from 'lucide-react'
import {
  AgentStreamThinkingChrome,
  AgentStreamToolCallsChrome,
} from '@/components/agent-stream/agent-stream-chrome'
import {
  ChatFileDownload,
  ChatFileDownloadAll,
} from '@/app/(interfaces)/chat/components/message/components/file-download'
import MarkdownRenderer from '@/app/(interfaces)/chat/components/message/components/markdown-renderer'

export interface ChatAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  size?: number
}

export interface ChatFile {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
}

/** Lifecycle status for a tool chip (agent-events-v1). No args/results. */
export type ChatToolCallStatus = 'running' | 'success' | 'error' | 'cancelled'

export interface ChatToolCall {
  /** Stable UI key: `${blockId}:${id}`. */
  key: string
  blockId: string
  id: string
  name: string
  displayName: string
  status: ChatToolCallStatus
}

export interface ChatMessage {
  id: string
  content: string | Record<string, unknown>
  type: 'user' | 'assistant'
  timestamp: Date
  isInitialMessage?: boolean
  isStreaming?: boolean
  /** Model thinking text (agent-events-v1). Chrome only when non-empty. */
  thinking?: string
  /** True while thinking deltas are still arriving (before first answer chunk / final). */
  isThinkingStreaming?: boolean
  /** Tool lifecycle chips (name + status only). Chrome only when non-empty. */
  toolCalls?: ChatToolCall[]
  /** True while any tool chip is still `running`. */
  isToolStreaming?: boolean
  attachments?: ChatAttachment[]
  files?: ChatFile[]
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
} as const

/**
 * Escapes HTML entities so untrusted strings are safe to interpolate into markup.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] || c)
}

/**
 * Opens an image attachment preview in a new tab via a blob URL,
 * escaping the user-controlled filename and data URL to prevent XSS.
 */
function openAttachmentPreview(name: string, dataUrl: string): void {
  const safeName = escapeHtml(name)
  const safeUrl = escapeHtml(dataUrl)
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${safeName}</title>
        <style>
          body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
          img { max-width: 100%; max-height: 100vh; object-fit: contain; }
        </style>
      </head>
      <body>
        <img src="${safeUrl}" alt="${safeName}" />
      </body>
    </html>
  `
  const blob = new Blob([html], { type: 'text/html' })
  const blobUrl = URL.createObjectURL(blob)
  window.open(blobUrl, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}

function toolCallsFingerprint(toolCalls: ChatToolCall[] | undefined): string {
  if (!toolCalls?.length) return ''
  return toolCalls.map((t) => `${t.key}:${t.status}`).join('|')
}

export const ClientChatMessage = memo(
  function ClientChatMessage({ message }: { message: ChatMessage }) {
    const [isCopied, setIsCopied] = useState(false)

    const isJsonObject = typeof message.content === 'object' && message.content !== null

    // Answer text is streamed separately from thinking / tool lifecycle events.
    const cleanTextContent = message.content
    const hasThinking = typeof message.thinking === 'string' && message.thinking.length > 0
    const hasToolCalls = Array.isArray(message.toolCalls) && message.toolCalls.length > 0

    const content =
      message.type === 'user' ? (
        <div className='px-4 py-5' data-message-id={message.id}>
          <div className='mx-auto max-w-3xl'>
            {/* File attachments displayed above the message */}
            {message.attachments && message.attachments.length > 0 && (
              <div className='mb-2 flex justify-end'>
                <div className='flex flex-wrap gap-2'>
                  {message.attachments.map((attachment) => {
                    const isImage = attachment.type.startsWith('image/')
                    const getFileIcon = (type: string) => {
                      if (type.includes('pdf'))
                        return <FileText className='size-5 text-[var(--text-muted)] md:size-6' />
                      if (type.startsWith('image/'))
                        return <ImageIcon className='size-5 text-[var(--text-muted)] md:size-6' />
                      if (type.includes('text') || type.includes('json'))
                        return <FileText className='size-5 text-[var(--text-muted)] md:size-6' />
                      return <FileIcon className='size-5 text-[var(--text-muted)] md:size-6' />
                    }
                    const formatFileSize = (bytes?: number) => {
                      if (!bytes || bytes === 0) return ''
                      const k = 1024
                      const sizes = ['B', 'KB', 'MB', 'GB']
                      const i = Math.floor(Math.log(bytes) / Math.log(k))
                      return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                    }

                    const isInteractive =
                      !!attachment.dataUrl?.trim() && attachment.dataUrl.startsWith('data:')

                    const handleOpenPreview = () => {
                      const validDataUrl = attachment.dataUrl?.trim()
                      if (!validDataUrl?.startsWith('data:')) return
                      openAttachmentPreview(attachment.name, validDataUrl)
                    }

                    return (
                      <div
                        key={attachment.id}
                        role={isInteractive ? 'button' : undefined}
                        aria-disabled={!isInteractive}
                        tabIndex={isInteractive ? 0 : undefined}
                        className={cn(
                          'relative overflow-hidden rounded-2xl border border-[var(--border-1)] bg-[var(--surface-2)]',
                          isInteractive && 'cursor-pointer',
                          isImage
                            ? 'size-16 md:size-20'
                            : 'flex h-16 min-w-[140px] max-w-[220px] items-center gap-2 px-3 md:h-20 md:min-w-[160px] md:max-w-[240px]'
                        )}
                        onClick={(e) => {
                          if (!isInteractive) return
                          e.preventDefault()
                          e.stopPropagation()
                          handleOpenPreview()
                        }}
                        onKeyDown={(e) => {
                          if (!isInteractive) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            handleOpenPreview()
                          }
                        }}
                      >
                        {isImage &&
                        attachment.dataUrl?.trim() &&
                        attachment.dataUrl.startsWith('data:') ? (
                          <img
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            className='size-full object-cover'
                          />
                        ) : (
                          <>
                            <div className='flex size-10 flex-shrink-0 items-center justify-center rounded bg-[var(--surface-3)] md:size-12'>
                              {getFileIcon(attachment.type)}
                            </div>
                            <div className='min-w-0 flex-1'>
                              <div className='truncate font-medium text-[var(--text-primary)] text-xs md:text-sm'>
                                {attachment.name}
                              </div>
                              {attachment.size && (
                                <div className='text-[var(--text-muted)] text-micro md:text-xs'>
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

            {/* Only render message bubble if there's actual text content (not just file count message) */}
            {message.content && !String(message.content).startsWith('Sent') && (
              <div className='flex justify-end'>
                <div className='max-w-[80%] rounded-3xl bg-[var(--surface-3)] px-4 py-3'>
                  <div className='whitespace-pre-wrap break-words text-[var(--text-primary)] text-base leading-relaxed'>
                    {isJsonObject ? (
                      <pre>{JSON.stringify(message.content, null, 2)}</pre>
                    ) : (
                      <span>{message.content as string}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className='px-4 pt-5 pb-2' data-message-id={message.id}>
          <div className='mx-auto max-w-3xl'>
            <div className='flex flex-col space-y-3'>
              <div>
                {hasThinking && (
                  <AgentStreamThinkingChrome
                    thinking={message.thinking!}
                    isStreaming={message.isThinkingStreaming}
                  />
                )}
                {hasToolCalls && (
                  <AgentStreamToolCallsChrome
                    toolCalls={message.toolCalls!}
                    isStreaming={message.isToolStreaming}
                  />
                )}
                <div className='break-words text-base'>
                  {isJsonObject ? (
                    <pre className='text-[var(--text-primary)]'>
                      {JSON.stringify(cleanTextContent, null, 2)}
                    </pre>
                  ) : (
                    <MarkdownRenderer content={cleanTextContent as string} />
                  )}
                </div>
              </div>
              {message.files && message.files.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {message.files.map((file) => (
                    <ChatFileDownload key={file.id} file={file} />
                  ))}
                </div>
              )}
              {message.type === 'assistant' && !isJsonObject && !message.isInitialMessage && (
                <div className='flex items-center justify-start space-x-2'>
                  {/* Copy Button - Only show when not streaming */}
                  {!message.isStreaming && (
                    <Tooltip.Root delayDuration={300}>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='ghost-secondary'
                          className='p-0'
                          onClick={() => {
                            const contentToCopy =
                              typeof cleanTextContent === 'string'
                                ? cleanTextContent
                                : JSON.stringify(cleanTextContent, null, 2)
                            navigator.clipboard.writeText(contentToCopy)
                            setIsCopied(true)
                            setTimeout(() => setIsCopied(false), 2000)
                          }}
                        >
                          {isCopied ? (
                            <Check className='size-3' strokeWidth={2} />
                          ) : (
                            <Duplicate className='size-3' />
                          )}
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top' align='center' sideOffset={5}>
                        {isCopied ? 'Copied!' : 'Copy to clipboard'}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  )}
                  {/* Download All Button - Only show when there are files */}
                  {!message.isStreaming && message.files && (
                    <ChatFileDownloadAll files={message.files} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )

    return <Tooltip.Provider>{content}</Tooltip.Provider>
  },
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.thinking === nextProps.message.thinking &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.isThinkingStreaming === nextProps.message.isThinkingStreaming &&
      prevProps.message.isToolStreaming === nextProps.message.isToolStreaming &&
      toolCallsFingerprint(prevProps.message.toolCalls) ===
        toolCallsFingerprint(nextProps.message.toolCalls) &&
      prevProps.message.isInitialMessage === nextProps.message.isInitialMessage &&
      prevProps.message.files?.length === nextProps.message.files?.length
    )
  }
)
