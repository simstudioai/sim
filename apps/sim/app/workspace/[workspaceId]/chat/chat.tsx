'use client'

import { useCallback, useRef, useState } from 'react'
import { Check, CircleAlert, Loader2, Send, Square, Zap } from 'lucide-react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ContentBlock, ToolCallInfo, ToolCallStatus } from './hooks/use-workspace-chat'
import { useWorkspaceChat } from './hooks/use-workspace-chat'

const REMARK_PLUGINS = [remarkGfm]

/** Status icon for a tool call. */
function ToolStatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case 'executing':
      return <Loader2 className='h-3 w-3 animate-spin text-[var(--text-tertiary)]' />
    case 'success':
      return <Check className='h-3 w-3 text-emerald-500' />
    case 'error':
      return <CircleAlert className='h-3 w-3 text-red-400' />
  }
}

/** Formats a tool name for display: "edit_workflow" → "Edit Workflow". */
function formatToolName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Compact inline rendering of a single tool call. */
function ToolCallItem({ toolCall }: { toolCall: ToolCallInfo }) {
  const label = toolCall.displayTitle || formatToolName(toolCall.name)

  return (
    <div className='flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5'>
      <Zap className='h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]' />
      <span className='min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]'>{label}</span>
      <ToolStatusIcon status={toolCall.status} />
    </div>
  )
}

/** Renders a subagent activity label. */
function SubagentLabel({ label }: { label: string }) {
  return (
    <div className='flex items-center gap-2 py-0.5'>
      <Loader2 className='h-3 w-3 animate-spin text-[var(--text-tertiary)]' />
      <span className='text-xs text-[var(--text-tertiary)]'>{label}</span>
    </div>
  )
}

/** Renders structured content blocks for an assistant message. */
function AssistantContent({ blocks, isStreaming }: { blocks: ContentBlock[]; isStreaming: boolean }) {
  return (
    <div className='space-y-2'>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text': {
            if (!block.content?.trim()) return null
            return (
              <div key={`text-${i}`} className='prose-sm prose-invert max-w-none'>
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{block.content}</ReactMarkdown>
              </div>
            )
          }
          case 'tool_call': {
            if (!block.toolCall) return null
            return <ToolCallItem key={block.toolCall.id} toolCall={block.toolCall} />
          }
          case 'subagent': {
            if (!block.content) return null
            // Only show the subagent label if it's the last subagent block and we're streaming
            const isLastSubagent =
              isStreaming &&
              blocks.slice(i + 1).every((b) => b.type !== 'subagent')
            if (!isLastSubagent) return null
            return <SubagentLabel key={`sub-${i}`} label={block.content} />
          }
          default:
            return null
        }
      })}
    </div>
  )
}

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
        <h1 className='font-medium text-[16px] text-[var(--text-primary)]'>Mothership</h1>
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
                isSending &&
                msg.role === 'assistant' &&
                !msg.content &&
                (!msg.contentBlocks || msg.contentBlocks.length === 0)
              if (isStreamingEmpty) {
                return (
                  <div key={msg.id} className='flex justify-start'>
                    <div className='flex items-center gap-2 rounded-lg bg-[var(--surface-3)] px-4 py-2 text-sm text-[var(--text-secondary)]'>
                      <Loader2 className='h-3 w-3 animate-spin' />
                      Thinking...
                    </div>
                  </div>
                )
              }

              // Skip empty assistant messages
              if (
                msg.role === 'assistant' &&
                !msg.content &&
                (!msg.contentBlocks || msg.contentBlocks.length === 0)
              )
                return null

              // User messages
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className='flex justify-end'>
                    <div className='max-w-[85%] rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-foreground)]'>
                      <p className='whitespace-pre-wrap'>{msg.content}</p>
                    </div>
                  </div>
                )
              }

              // Assistant messages with content blocks
              const hasBlocks = msg.contentBlocks && msg.contentBlocks.length > 0
              const isThisMessageStreaming = isSending && msg === messages[messages.length - 1]

              return (
                <div key={msg.id} className='flex justify-start'>
                  <div className='max-w-[85%] rounded-lg bg-[var(--surface-3)] px-4 py-2 text-sm text-[var(--text-primary)]'>
                    {hasBlocks ? (
                      <AssistantContent
                        blocks={msg.contentBlocks!}
                        isStreaming={isThisMessageStreaming}
                      />
                    ) : (
                      <div className='prose-sm prose-invert max-w-none'>
                        <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
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
