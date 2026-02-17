'use client'

import { useCallback, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useWorkspaceChat } from './hooks/use-workspace-chat'

export function Chat() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { messages, isSending, error, sendMessage, abortMessage } = useWorkspaceChat({
    workspaceId,
  })

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !workspaceId) return

    setInputValue('')
    await sendMessage(trimmed)
    scrollToBottom()
  }, [inputValue, workspaceId, sendMessage, scrollToBottom])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='flex flex-shrink-0 items-center border-b border-[var(--border)] px-6 py-3'>
        <h1 className='font-medium text-[16px] text-[var(--text-primary)]'>Chat</h1>
      </div>

      {/* Messages area */}
      <div className='flex-1 overflow-y-auto px-6 py-4'>
        {messages.length === 0 && !isSending ? (
          <div className='flex h-full items-center justify-center'>
            <div className='flex flex-col items-center gap-3 text-center'>
              <p className='text-[var(--text-secondary)] text-sm'>
                Ask anything about your workspace — build workflows, manage resources, get help.
              </p>
            </div>
          </div>
        ) : (
          <div className='mx-auto max-w-3xl space-y-4'>
            {messages.map((msg) => {
              const isStreamingEmpty =
                isSending && msg.role === 'assistant' && !msg.content
              if (isStreamingEmpty) {
                return (
                  <div key={msg.id} className='flex justify-start'>
                    <div className='rounded-lg bg-[var(--surface-3)] px-4 py-2 text-sm text-[var(--text-secondary)]'>
                      Thinking...
                    </div>
                  </div>
                )
              }
              if (msg.role === 'assistant' && !msg.content) return null
              return (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-4 py-2 text-sm',
                      msg.role === 'user'
                        ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                        : 'bg-[var(--surface-3)] text-[var(--text-primary)]'
                    )}
                  >
                    <p className='whitespace-pre-wrap'>{msg.content}</p>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className='px-6 pb-2'>
          <p className='text-xs text-red-500'>{error}</p>
        </div>
      )}

      {/* Input area */}
      <div className='flex-shrink-0 border-t border-[var(--border)] px-6 py-4'>
        <div className='mx-auto flex max-w-3xl items-end gap-2'>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Send a message...'
            rows={1}
            className='flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus:outline-none'
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`
            }}
          />
          {isSending ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={abortMessage}
              className='h-[38px] w-[38px] flex-shrink-0 p-0'
            >
              <Square className='h-4 w-4' />
            </Button>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className='h-[38px] w-[38px] flex-shrink-0 p-0'
            >
              <Send className='h-4 w-4' />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
