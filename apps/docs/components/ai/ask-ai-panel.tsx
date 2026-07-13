'use client'

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ArrowUp, MessageCircle, Square, X } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import 'streamdown/styles.css'

interface DocSource {
  title: string
  url: string
}

/** Pull the deduped doc sources surfaced by the searchDocs tool out of a message's parts. */
function getSources(parts: ReadonlyArray<{ type: string; [key: string]: unknown }>): DocSource[] {
  const seen = new Set<string>()
  const sources: DocSource[] = []

  for (const part of parts) {
    if (part.type !== 'tool-searchDocs') continue
    const output = (part as { output?: unknown }).output
    if (!Array.isArray(output)) continue
    for (const item of output as DocSource[]) {
      if (!item?.url || seen.has(item.url)) continue
      seen.add(item.url)
      sources.push({ title: item.title, url: item.url })
    }
  }

  return sources
}

/** Concatenate the streamed text parts of a message. */
function getText(parts: ReadonlyArray<{ type: string; [key: string]: unknown }>): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as unknown as { text: string }).text)
    .join('')
}

interface AskAIPanelProps {
  /** Active docs locale, forwarded so retrieval is scoped to the reader's language. */
  locale: string
  onClose: () => void
}

export function AskAIPanel({ locale, onClose }: AskAIPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), [])

  const { messages, sendMessage, status, stop, error } = useChat({ transport })

  const isBusy = status === 'submitted' || status === 'streaming'

  const handleClose = () => {
    stop()
    onClose()
  }

  useEffect(() => {
    textareaRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || isBusy) return
    sendMessage({ text }, { body: { locale } })
    setInput('')
  }

  return (
    <div
      role='dialog'
      aria-label='Ask Sim'
      className='fixed right-4 bottom-4 z-50 flex h-[600px] max-h-[calc(100vh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--surface-5)] shadow-[var(--shadow-medium)] dark:bg-[var(--surface-4)]'
    >
      <div className='flex items-center justify-between border-[var(--border-1)] border-b px-4 py-3'>
        <span className='flex items-center gap-1.5 font-season text-[var(--text-body)] text-sm'>
          <MessageCircle className='size-[16px] text-[var(--text-icon)]' />
          Ask Sim
        </span>
        <button
          type='button'
          aria-label='Close'
          onClick={handleClose}
          className='flex size-7 items-center justify-center rounded-lg text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)]'
        >
          <X className='size-[16px]' />
        </button>
      </div>

      <div ref={scrollRef} className='flex-1 space-y-4 overflow-y-auto px-4 py-4'>
        {messages.length === 0 && (
          <p className='text-[var(--text-muted)] text-sm'>
            Ask anything about building, deploying, and managing AI agents in Sim.
          </p>
        )}

        {messages.map((message, index) => {
          const text = getText(message.parts)
          const isStreaming = isBusy && index === messages.length - 1
          const sources = message.role === 'assistant' ? getSources(message.parts) : []
          return (
            <div
              key={message.id}
              className={cn(
                'flex flex-col gap-1.5',
                message.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              {message.role === 'user' ? (
                <div className='max-w-[85%] whitespace-pre-wrap rounded-[16px] bg-[var(--surface-5)] px-3 py-2 text-[var(--text-primary)] text-base leading-[23px]'>
                  {text}
                </div>
              ) : (
                <div className='max-w-full text-[var(--text-primary)] text-base'>
                  {text ? (
                    <Streamdown
                      className={cn(
                        'space-y-3 text-[var(--text-primary)] text-base leading-relaxed',
                        '[&_a]:text-[var(--text-primary)] [&_a]:underline [&_a]:decoration-dashed [&_a]:underline-offset-4',
                        '[&_strong]:font-[600]',
                        '[&_h1]:font-[600] [&_h2]:font-[600] [&_h3]:font-[600] [&_h4]:font-[600]',
                        '[&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5',
                        '[&_code]:font-mono [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--surface-5)] [&_pre]:p-3 [&_pre]:text-small'
                      )}
                    >
                      {text}
                    </Streamdown>
                  ) : isStreaming ? (
                    '…'
                  ) : sources.length === 0 ? (
                    <span className='text-[var(--text-muted)]'>No answer returned.</span>
                  ) : null}
                </div>
              )}
              {sources.length > 0 && (
                <div className='flex max-w-[90%] flex-wrap gap-1.5'>
                  {sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='rounded-lg border border-[var(--border-1)] px-2 py-0.5 text-[var(--text-muted)] text-xs transition-colors hover:bg-[var(--surface-active)]'
                    >
                      {source.title || source.url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {error && (
          <p className='text-[var(--text-muted)] text-sm'>Something went wrong. Please try again.</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className='px-3 pb-3'>
        <div className='flex items-end gap-2 rounded-2xl border border-[var(--border-1)] bg-white px-2.5 py-1.5 dark:bg-[var(--surface-5)]'>
          <textarea
            ref={textareaRef}
            aria-label='Ask Sim about the docs'
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSubmit(event)
              }
            }}
            rows={1}
            placeholder='Ask Sim about the docs…'
            className='max-h-32 flex-1 resize-none bg-transparent py-1 font-season text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]'
          />
          {isBusy ? (
            <button
              type='button'
              aria-label='Stop'
              onClick={() => stop()}
              className='flex size-[28px] shrink-0 items-center justify-center rounded-full bg-[#383838] transition-colors hover:bg-[#575757] dark:bg-[#e0e0e0] dark:hover:bg-[#cfcfcf]'
            >
              <Square className='size-[12px] fill-white text-white dark:fill-black dark:text-black' />
            </button>
          ) : (
            <button
              type='submit'
              aria-label='Send'
              disabled={!input.trim()}
              className={cn(
                'flex size-[28px] shrink-0 items-center justify-center rounded-full transition-colors',
                input.trim()
                  ? 'bg-[#383838] hover:bg-[#575757] dark:bg-[#e0e0e0] dark:hover:bg-[#cfcfcf]'
                  : 'bg-[#808080]'
              )}
            >
              <ArrowUp className='size-[16px] text-white dark:text-black' />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
