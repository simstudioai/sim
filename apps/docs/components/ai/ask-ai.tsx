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

interface AskAIProps {
  /** Active docs locale, forwarded so retrieval is scoped to the reader's language. */
  locale: string
}

export function AskAI({ locale }: AskAIProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stable transport; the locale is sent per-message (below) so it stays current
  // after a language switch instead of being frozen into the transport.
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), [])

  const { messages, sendMessage, status, stop, error } = useChat({ transport })

  const isBusy = status === 'submitted' || status === 'streaming'

  // Jump to the bottom instantly when the panel opens (a mount transition).
  useEffect(() => {
    if (!open) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [open])

  // Smooth-scroll as new messages stream in (an explicit re-orientation cue).
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
    <>
      {!open && (
        <button
          type='button'
          aria-label='Ask AI'
          onClick={() => setOpen(true)}
          className='fixed right-4 bottom-4 z-50 flex h-11 items-center gap-2 rounded-full border border-[var(--border-1)] bg-[var(--surface-5)] px-4 font-season text-[var(--text-base)] text-sm shadow-lg transition-colors hover:bg-[var(--surface-active)] dark:bg-[var(--surface-4)]'
        >
          <MessageCircle className='size-[16px] text-[var(--text-icon)]' />
          Ask AI
        </button>
      )}

      {open && (
        <div className='fixed right-4 bottom-4 z-50 flex h-[600px] max-h-[calc(100vh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--surface-5)] shadow-xl dark:bg-[var(--surface-4)]'>
          <div className='flex items-center justify-between border-[var(--border-1)] border-b px-4 py-3'>
            <span className='flex items-center gap-2 font-season text-[var(--text-base)] text-sm'>
              <MessageCircle className='size-[16px] text-[var(--text-icon)]' />
              Ask AI
            </span>
            <button
              type='button'
              aria-label='Close'
              onClick={() => {
                stop()
                setOpen(false)
              }}
              className='flex size-7 items-center justify-center rounded-md text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)]'
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

            {messages.map((message) => {
              const text = getText(message.parts)
              const sources = message.role === 'assistant' ? getSources(message.parts) : []
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex flex-col gap-1',
                    message.role === 'user' ? 'items-end' : 'items-start'
                  )}
                >
                  {message.role === 'user' ? (
                    <div className='max-w-[90%] whitespace-pre-wrap rounded-lg bg-[var(--surface-active)] px-3 py-2 text-[var(--text-base)] text-sm'>
                      {text}
                    </div>
                  ) : (
                    <div className='max-w-[90%] text-[var(--text-base)] text-sm'>
                      {text ? (
                        <Streamdown className='space-y-2 text-sm leading-relaxed [&_a]:text-[var(--text-link)] [&_a]:underline [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5'>
                          {text}
                        </Streamdown>
                      ) : isBusy ? (
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
                          className='rounded-md border border-[var(--border-1)] px-2 py-0.5 text-[var(--text-muted)] text-xs transition-colors hover:bg-[var(--surface-active)]'
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
              <p className='text-[var(--text-muted)] text-sm'>
                Something went wrong. Please try again.
              </p>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className='flex items-end gap-2 border-[var(--border-1)] border-t px-3 py-3'
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  handleSubmit(event)
                }
              }}
              rows={1}
              placeholder='Ask a question…'
              className='max-h-32 flex-1 resize-none bg-transparent font-season text-[var(--text-base)] text-sm outline-none placeholder:text-[var(--text-muted)]'
            />
            {isBusy ? (
              <button
                type='button'
                aria-label='Stop'
                onClick={() => stop()}
                className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-active)] text-[var(--text-icon)]'
              >
                <Square className='size-[14px]' />
              </button>
            ) : (
              <button
                type='submit'
                aria-label='Send'
                disabled={!input.trim()}
                className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--text-base)] text-[var(--surface-5)] transition-opacity disabled:opacity-40 dark:bg-[var(--text-base)]'
              >
                <ArrowUp className='size-[16px]' />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  )
}
